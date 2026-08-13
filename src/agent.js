/**
 * The agent loop.
 *
 *   ingest -> extract_claim -> reconcile -> retrieve(trust) -> verify(if
 *   load-bearing) -> act        and on failure:
 *   quarantine -> $graphLookup cascade -> revoke -> downgrade source
 *
 * Every step writes an event into a `runs` document before it does anything
 * else, so the run is recoverable at any point and so the demo can print what
 * the agent decided rather than what we say it decided.
 *
 * The structure is the point: `retrieve` sits between `ingest` and `act` as a
 * function call, not as a line in a prompt. An agent cannot skip it by being
 * talked out of it.
 */
import { collections } from "./db.js";
import { recordBelief, listBeliefs } from "./beliefs.js";
import { retrieve } from "./retrieve.js";
import { findContradictions } from "./contradict.js";
import { assessLoadBearing, verifyAgainstLedger } from "./verify.js";
import { quarantineAndCascade } from "./cascade.js";
import { execute } from "./act.js";
import { extractClaim } from "./extract.js";

/* ------------------------------------------------------------------ runs */

export async function startRun(kind) {
  const { runs } = await collections();
  const { insertedId } = await runs.insertOne({
    kind,
    started_at: new Date(),
    finished_at: null,
    events: [],
  });
  return insertedId;
}

export async function logEvent(runId, step, detail = {}) {
  const { runs } = await collections();
  await runs.updateOne(
    { _id: runId },
    { $push: { events: { step, at: new Date(), ...detail } } }
  );
  return { step, ...detail };
}

export async function finishRun(runId) {
  const { runs } = await collections();
  await runs.updateOne({ _id: runId }, { $set: { finished_at: new Date() } });
}

/* --------------------------------------------------------------- ingest */

/**
 * Read a message and store what it asserts.
 *
 * Note what does *not* happen here: no filter, no gate, no human. That is
 * faithful to the threat, not a shortcut. Memory poisoning is interesting
 * precisely because the write is indistinguishable from a normal one at the
 * moment it happens.
 */
export async function ingest({ ticket, sourceId, runId, preferLlm = true }) {
  const extracted = await extractClaim(ticket, { preferLlm });
  if (!extracted) {
    await logEvent(runId, "ingest", { ticket: ticket.id, outcome: "no claim extracted" });
    return { stored: null, extracted: null };
  }

  const { conflicts, duplicates } = await findContradictions({
    subjectKey: extracted.subject_key,
    claim: extracted.claim,
    polarity: extracted.polarity,
  });

  const belief = await recordBelief({
    subjectKey: extracted.subject_key,
    claim: extracted.claim,
    polarity: extracted.polarity,
    sourceId,
    derivedFrom: [],
    confidence: extracted.confidence,
    originTicket: ticket.id,
    runId,
  });

  await logEvent(runId, "ingest", {
    ticket: ticket.id,
    belief_id: belief._id,
    subject_key: belief.subject_key,
    extraction_mode: extracted.mode,
    conflicts: conflicts.length,
  });

  return { stored: belief, extracted, conflicts, duplicates };
}

/**
 * Record a conclusion the agent reasoned to, with its parents.
 *
 * `derivedFrom` is the whole reason this project exists. Without it there is a
 * list of beliefs and no way back from a bad one; with it there is a graph and
 * `$graphLookup` can answer "what did this contaminate".
 */
export async function derive({ parents, subjectKey, claim, confidence, sourceId, runId }) {
  const belief = await recordBelief({
    subjectKey,
    claim,
    polarity: 1,
    sourceId,
    derivedFrom: parents,
    confidence,
    runId,
  });
  await logEvent(runId, "derive", {
    belief_id: belief._id,
    subject_key: subjectKey,
    parents: parents.length,
  });
  return belief;
}

/* ----------------------------------------------------------- suppression */

/**
 * Does memory currently contain a belief that tells the agent it may skip the
 * pre-action check?
 *
 * This is not a bug we left in. It is the mechanism that makes memory poisoning
 * different in kind from prompt injection: the payload does not bypass the
 * check once, it installs a standing belief that the check is unnecessary — and
 * the agent then honours that belief on every future run, from a cold context,
 * with the original message long gone.
 *
 * Immune's answer is not to hard-code an exception. It is that this belief is
 * itself a node in the provenance graph, so when its ancestor is refuted it is
 * revoked with everything else and the check comes back on by itself.
 */
export async function checkSuppression({ subjectKey, minTrust = 0.5 }) {
  const { hits } = await retrieve({
    query: "destination change review can be skipped, already verified",
    subjectKey: "refund.escalation",
    minTrust,
    limit: 3,
  });
  const suppressor = hits.find((h) => h.score > 0.4);
  return suppressor || null;
}

/* -------------------------------------------------------------- act */

/**
 * The decision path: retrieve under the trust filter, verify if load-bearing,
 * then act or refuse.
 *
 * Returns the whole trace, because the trace *is* the demo.
 */
export async function decideAndAct({
  runId,
  intent,
  subjectKey,
  actionKind,
  buildPayload,
  allowSuppression = true,
}) {
  const trace = { intent, steps: [] };

  // 1 — retrieve, under the trust pre-filter
  const { hits, mode, filter } = await retrieve({ query: intent, subjectKey });
  trace.retrieval = { mode, filter, hits };
  await logEvent(runId, "retrieve", { subject_key: subjectKey, mode, returned: hits.length });

  if (hits.length === 0) {
    trace.outcome = "refused";
    trace.reason = "memory returned no trusted belief for this subject";
    await logEvent(runId, "refuse", { subject_key: subjectKey, reason: trace.reason });
    return trace;
  }

  const primary = hits[0];
  const { beliefs } = await collections();
  const belief = await beliefs.findOne({ _id: primary._id });

  // 2 — is this load-bearing? Only then is it worth checking.
  const pendingAction = { kind: actionKind };
  const assessment = await assessLoadBearing(belief, { pendingAction });
  trace.assessment = assessment;
  await logEvent(runId, "assess", {
    belief_id: belief._id,
    load_bearing: assessment.loadBearing,
    reasons: assessment.reasons,
  });

  // 3 — verification, unless memory says it has already been done
  let verification = null;
  const suppressor = allowSuppression
    ? await checkSuppression({ subjectKey })
    : null;

  if (assessment.loadBearing && suppressor) {
    trace.suppressedBy = suppressor;
    await logEvent(runId, "verify", {
      belief_id: belief._id,
      outcome: "skipped",
      suppressed_by: suppressor._id,
    });
  } else if (assessment.loadBearing) {
    verification = verifyAgainstLedger(belief);
    trace.verification = verification;
    await logEvent(runId, "verify", {
      belief_id: belief._id,
      verdict: verification.verdict,
      detail: verification.detail,
    });

    if (verification.verdict === "refuted") {
      const cascade = await quarantineAndCascade({
        beliefId: belief._id,
        evidenceRunId: runId,
        reason: `refuted by ${verification.source}: ${verification.detail}`,
      });
      trace.cascade = cascade;
      trace.outcome = "quarantined";
      await logEvent(runId, "cascade", {
        belief_id: belief._id,
        revoked: cascade.revokedBeliefs.length,
        reversed: cascade.reversedActions.length,
        trust: cascade.sourceTrust,
      });
      return trace;
    }
  }

  // 4 — act
  const action = await execute({
    kind: actionKind,
    payload: buildPayload(hits),
    usedBeliefs: hits.map((h) => h._id),
    runId,
  });
  trace.action = action;
  trace.outcome = "executed";
  await logEvent(runId, "act", { action_id: action._id, kind: actionKind });
  return trace;
}

/* ------------------------------------------------------------ integrity */

/**
 * The memory-integrity pass.
 *
 * Runs when a trusted source writes a claim that collides with something
 * already believed. This trigger is deliberately *not* suppressible by a stored
 * belief: a belief may tell the agent a pre-action check is unnecessary, but
 * nothing a belief says can stop two contradictory records being compared. That
 * asymmetry is what lets the agent escape a poisoned state on its own.
 */
export async function integrityPass({ runId, subjectKey, incomingClaim, incomingPolarity = 1 }) {
  const { conflicts } = await findContradictions({
    subjectKey,
    claim: incomingClaim,
    polarity: incomingPolarity,
  });
  await logEvent(runId, "integrity", { subject_key: subjectKey, conflicts: conflicts.length });

  if (conflicts.length === 0) return { conflicts: [], resolved: [] };

  const { beliefs } = await collections();
  const resolved = [];
  for (const conflict of conflicts) {
    const belief = await beliefs.findOne({ _id: conflict._id });
    const assessment = await assessLoadBearing(belief);
    const verification = verifyAgainstLedger(belief);
    await logEvent(runId, "verify", {
      belief_id: belief._id,
      verdict: verification.verdict,
      detail: verification.detail,
      trigger: "contradiction",
    });

    if (verification.verdict === "refuted") {
      const cascade = await quarantineAndCascade({
        beliefId: belief._id,
        evidenceRunId: runId,
        reason: `refuted by ${verification.source}: ${verification.detail}`,
      });
      resolved.push({ belief, assessment, verification, cascade });
      await logEvent(runId, "cascade", {
        belief_id: belief._id,
        revoked: cascade.revokedBeliefs.length,
        reversed: cascade.reversedActions.length,
      });
    } else {
      resolved.push({ belief, assessment, verification, cascade: null });
    }
  }
  return { conflicts, resolved };
}

export async function memorySnapshot() {
  const { sources, actions } = await collections();
  return {
    beliefs: await listBeliefs({}),
    sources: await sources.find({}).sort({ trust: -1 }).toArray(),
    actions: await actions.find({}).sort({ ts: 1 }).toArray(),
  };
}
