/**
 * The live, audience-driven attack path.
 *
 * `scripts/demo.js` runs the attack from a frozen fixture. This module runs the
 * *same* attack when a stranger with a phone fires it, and it deliberately
 * reuses the exact functions the scripted demo uses — `ingest`, `derive`,
 * `decideAndAct`, `integrityPass`, `quarantineAndCascade`. There is no second
 * implementation of the agent for the live surface, because two code paths mean
 * the thing on stage is not the thing that was tested.
 *
 * What is different is only the *source of the message*: a human in the room
 * instead of a fixture on disk. Which is the whole thesis. Memory has an
 * unauthenticated write path; it does not care who is standing at it.
 *
 * The four phases the room sees, in order:
 *
 *   signIn   a stranger becomes a `sources` document at trust 0.70
 *   attack   their claim is ingested, three conclusions are derived from it,
 *            and the agent pays out — with nothing looking wrong
 *   respond  the billing system of record speaks, verification refutes,
 *            $graphLookup revokes the subtree, the clean branch stays green
 *   retry    the same phone fires the same claim and it is inert, because the
 *            source now sits at 0.28 and the retrieval floor is 0.50
 */
import { collections } from "./db.js";
import {
  startRun,
  finishRun,
  logEvent,
  ingest,
  derive,
  decideAndAct,
  integrityPass,
} from "./agent.js";
import { retrieve, awaitIndexed } from "./retrieve.js";
import { listBeliefs } from "./beliefs.js";
import { RETRIEVAL_FLOOR } from "./trust.js";
import { extractDeterministic } from "./extract.js";
import {
  AUDIENCE_PAYLOADS,
  payloadById,
  freeTextTicket,
  ticketFor,
  DERIVATION_CHAIN,
  PAYOUT,
  TRUTH_CLAIM,
} from "../fixtures/audience.js";

/** Where a stranger starts. High enough to be believed, which is the point. */
export const AUDIENCE_START_TRUST = 0.7;

/**
 * Strip control characters and collapse whitespace.
 *
 * Not sanitisation in the security sense — the whole project is about what
 * happens *after* something hostile is believed, so filtering the content
 * would be answering a different problem. This only stops a pasted newline or
 * a terminal escape sequence from wrecking the wall's layout on a projector.
 */
const clean = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/* --------------------------------------------------------------- sign-in */

/**
 * Turn a person into a source.
 *
 * There is no authentication here and that is not a shortcut — an agent's
 * memory does not authenticate the origin of a claim either. A handle is
 * exactly as much identity as an email `From:` header carries, which is to say
 * none, and the whole project is about what you do *after* believing something
 * from a source like that.
 */
export async function signIn({ handle }) {
  const { sources } = await collections();
  const name = clean(handle).slice(0, 40) || "anonymous";

  const existing = await sources.findOne({ handle: name, kind: "human" });
  if (existing) return { source: existing, returning: true };

  const doc = {
    kind: "human",
    handle: name,
    label: "audience member",
    trust: AUDIENCE_START_TRUST,
    verified_count: 0,
    refuted_count: 0,
    first_seen: new Date(),
    last_updated: new Date(),
    audience: true,
  };
  const { insertedId } = await sources.insertOne(doc);
  return { source: { ...doc, _id: insertedId }, returning: false };
}

export function payloadMenu() {
  return AUDIENCE_PAYLOADS.map(({ id, label, blurb, channel, kind }) => ({
    id,
    label,
    blurb,
    channel,
    kind,
  }));
}

/* ---------------------------------------------------------------- attack */

/**
 * Fire one audience attack, end to end.
 *
 * The `awaitIndexed` calls are not defensive padding. Atlas Search indexes
 * update asynchronously, so a belief written a moment ago is durably in the
 * collection and *not yet retrievable* — and the agent's next step is to ask
 * memory whether that belief exists. Without the wait the agent takes a
 * different branch depending on index lag, which on a stage looks exactly like
 * a broken demo and is impossible to debug in front of people.
 */
export async function attack({ sourceId, payloadId = null, freeText = null, handle = "someone" }) {
  const { sources, beliefs } = await collections();
  const source = await sources.findOne({ _id: sourceId });
  if (!source) throw new Error("unknown source — sign in again");

  const seq = await beliefs.countDocuments({ origin_ticket: { $ne: null } });
  const payload = payloadById(payloadId);
  const ticket = payload
    ? ticketFor(payload, { handle: source.handle, seq: seq + 1 })
    : freeTextTicket({ handle: source.handle, text: clean(freeText).slice(0, 600) });

  if (!payload && !ticket.body) throw new Error("nothing to send");

  const runId = await startRun("audience-attack");
  const timeline = [];
  const mark = (phase, detail) => timeline.push({ phase, at: new Date(), ...detail });

  // Pre-flight: does anything in this message even parse as a claim? Answering
  // "no" is a legitimate outcome and the wall shows it as one.
  const preview = extractDeterministic(ticket);
  if (!preview) {
    await logEvent(runId, "ingest", { ticket: ticket.id, outcome: "no claim extracted" });
    await finishRun(runId);
    return {
      ok: false,
      reason: "no-claim",
      message:
        "Nothing in that message parses as a factual claim, so nothing was stored. " +
        "The agent read it and moved on.",
      ticket,
      timeline,
      runId,
    };
  }

  // 1 — the write nobody authorised
  const { stored, extracted, conflicts } = await ingest({
    ticket,
    sourceId,
    runId,
    preferLlm: false, // deterministic rung; see README on which rung we demo
  });
  await awaitIndexed(stored);
  mark("stored", {
    belief_id: stored._id,
    claim: stored.claim,
    subject_key: stored.subject_key,
    extraction_mode: extracted.mode,
    conflicts: conflicts.length,
  });

  // 2 — the agent reasons on top of it. This is what makes memory poisoning
  //     different in kind from prompt injection: the lie grows children.
  const agentSource = await sources.findOne({ handle: "immune.agent.self" });
  const derived = { root: stored };
  const derivedDocs = [];
  const iban = extracted.indicators?.[0] ?? "the destination on file";

  for (const link of DERIVATION_CHAIN) {
    const parent = derived[link.parent];
    if (!parent) continue;
    const child = await derive({
      parents: [parent._id],
      subjectKey: link.subject_key,
      claim: link.claim(iban),
      confidence: link.confidence,
      sourceId: agentSource?._id ?? sourceId,
      runId,
    });
    derived[link.key] = child;
    derivedDocs.push(child);
    mark("derived", {
      belief_id: child._id,
      claim: child.claim,
      subject_key: child.subject_key,
      parent: parent._id,
    });
  }
  await awaitIndexed(derivedDocs);

  // 3 — an ordinary, unrelated task. The lie is never mentioned; it is just
  //     what memory returns when the agent asks about payout destinations.
  const trace = await decideAndAct({
    runId,
    intent: "process the approved refund for account ACME-1042",
    subjectKey: "refund.destination",
    actionKind: "refund.payout",
    buildPayload: () => ({
      account: PAYOUT.account,
      amount: PAYOUT.amount,
      currency: PAYOUT.currency,
      destination_iban: iban,
      approval: "auto",
    }),
  });
  mark("acted", {
    outcome: trace.outcome,
    suppressed: Boolean(trace.suppressedBy),
    action: trace.action ? { kind: trace.action.kind, payload: trace.action.payload } : null,
  });

  await finishRun(runId);

  return {
    ok: true,
    runId,
    ticket,
    root: { _id: stored._id, claim: stored.claim, subject_key: stored.subject_key },
    derived: derivedDocs.map((d) => ({ _id: d._id, claim: d.claim, subject_key: d.subject_key })),
    outcome: trace.outcome,
    suppressed: Boolean(trace.suppressedBy),
    action: trace.action ?? null,
    extraction_mode: extracted.mode,
    improvised: Boolean(ticket.improvised),
    iban,
    timeline,
  };
}

/* -------------------------------------------------------------- response */

/**
 * The immune response.
 *
 * Triggered by a trusted source stating the true payout destination — not by an
 * operator pressing "fix it". The distinction matters on stage: the agent is
 * not being told which belief is wrong, it is being given a contradicting
 * record and working out the rest.
 *
 * Note what cannot be suppressed. A stored belief can talk the agent out of a
 * pre-action check; nothing a belief says can stop two contradictory records
 * being compared. That asymmetry is how the agent escapes a poisoned state
 * without anyone intervening.
 */
export async function immuneResponse() {
  const runId = await startRun("integrity");
  const { conflicts, resolved } = await integrityPass({
    runId,
    subjectKey: "refund.destination",
    incomingClaim: TRUTH_CLAIM,
  });

  const cascades = resolved.filter(
    (r) => r.cascade && !r.cascade.alreadyHandled && r.cascade.revokedBeliefs
  );

  // Wait until the revoked beliefs are *absent from the real retrieval filter*,
  // not merely updated in the collection. What sells the "same query, different
  // answer" frame is the query — so it must be the query that has changed.
  const revokedDocs = [];
  const { beliefs } = await collections();
  for (const r of cascades) {
    for (const d of r.cascade.revokedBeliefs) {
      const doc = await beliefs.findOne({ _id: d._id });
      if (doc) revokedDocs.push(doc);
    }
    const root = await beliefs.findOne({ _id: r.belief._id });
    if (root) revokedDocs.push(root);
  }
  await awaitIndexed(revokedDocs, { expect: "absent" });

  await finishRun(runId);

  const totals = cascades.reduce(
    (acc, r) => ({
      revoked: acc.revoked + r.cascade.revokedBeliefs.length,
      quarantined: acc.quarantined + 1,
      reversed: acc.reversed + r.cascade.reversedActions.length,
    }),
    { revoked: 0, quarantined: 0, reversed: 0 }
  );

  return {
    runId,
    conflicts: conflicts.length,
    cascades: cascades.map((r) => ({
      belief: { _id: r.belief._id, claim: r.belief.claim },
      verification: r.verification,
      revoked: r.cascade.revokedBeliefs,
      reversed: r.cascade.reversedActions,
      sourceTrust: r.cascade.sourceTrust,
      transactional: r.cascade.transactional,
      pipeline: r.cascade.pipeline,
    })),
    totals,
    /** The literal aggregation stage, for putting on screen. */
    pipeline: cascades[0]?.cascade.pipeline ?? null,
  };
}

/* ----------------------------------------------------------------- retry */

/**
 * The cold re-run, fired by the person who ran the original attack.
 *
 * This is the strongest twenty seconds available, and it is stronger when the
 * attacker triggers it themselves from the same phone. Nothing is in a context
 * window. The defence is a number on a document.
 */
export async function retry({ sourceId, payloadId = null, freeText = null }) {
  const { sources } = await collections();
  const source = await sources.findOne({ _id: sourceId });
  if (!source) throw new Error("unknown source — sign in again");

  const runId = await startRun("audience-retry");
  const result = await attackWrite({ source, payloadId, freeText, runId });
  await awaitIndexed(result.stored);

  // The same question the agent asked the first time round.
  const { hits, filter, mode } = await retrieve({
    query: "process the approved refund for account ACME-1042",
    subjectKey: "refund.destination",
  });

  const landed = hits.some((h) => String(h._id) === String(result.stored._id));
  await logEvent(runId, "retrieve", {
    subject_key: "refund.destination",
    returned: hits.length,
    repeat_claim_visible: landed,
  });
  await finishRun(runId);

  return {
    runId,
    written: true,
    visible: landed,
    trust: source.trust,
    floor: RETRIEVAL_FLOOR,
    retrieved: hits.length,
    filter,
    mode,
    belief: { _id: result.stored._id, claim: result.stored.claim },
    verdict: landed
      ? "landed — this source is still above the retrieval floor"
      : "inert — written to the database, invisible to the agent",
  };
}

async function attackWrite({ source, payloadId, freeText, runId }) {
  const { beliefs } = await collections();
  const seq = await beliefs.countDocuments({ origin_ticket: { $ne: null } });
  const payload = payloadById(payloadId) ?? AUDIENCE_PAYLOADS[0];
  const ticket = freeText
    ? freeTextTicket({ handle: source.handle, text: clean(freeText).slice(0, 600) })
    : ticketFor(payload, { handle: source.handle, seq: seq + 1 });
  const { stored } = await ingest({ ticket, sourceId: source._id, runId, preferLlm: false });
  if (!stored) throw new Error("the repeat message produced no claim");
  return { stored, ticket };
}

/* ------------------------------------------------------------ wall state */

/**
 * Everything the wall renders, in one round trip.
 *
 * Embeddings are projected out — 256 floats per belief times N beliefs is the
 * difference between a wall that updates instantly and one that stutters on
 * venue wifi.
 */
export async function wallState() {
  const { sources, actions } = await collections();
  const [allBeliefs, allSources, allActions] = await Promise.all([
    listBeliefs({}),
    sources.find({}).sort({ trust: -1 }).toArray(),
    actions.find({}).sort({ ts: 1 }).toArray(),
  ]);

  const sourceById = new Map(allSources.map((s) => [String(s._id), s]));
  const byId = new Map(allBeliefs.map((b) => [String(b._id), b]));

  const nodes = allBeliefs.map((b) => {
    const parents = (b.derived_from || []).map(String);
    const src = sourceById.get(String(b.source_id));
    return {
      id: String(b._id),
      claim: b.claim,
      subject_key: b.subject_key,
      status: b.status,
      confidence: b.confidence,
      parents,
      depth: depthOf(b, byId),
      source: src ? { handle: src.handle, kind: src.kind, trust: src.trust } : null,
      branch: branchOf(b, byId, sourceById),
      origin_ticket: b.origin_ticket || null,
      /**
       * Active, undamaged, and invisible to the agent.
       *
       * This is the cold re-run made into a property of a document. The repeat
       * attack is not blocked and not deleted — it is written, it is `active`,
       * and the retrieval pre-filter steps over it because its source fell
       * below the floor. Without flagging it the wall paints it green like any
       * other live belief, and the single best twenty seconds of the demo
       * becomes invisible at exactly the moment it should be obvious.
       */
      inert: b.status === "active" && (src?.trust ?? 1) < RETRIEVAL_FLOOR,
    };
  });

  return {
    at: new Date().toISOString(),
    floor: RETRIEVAL_FLOOR,
    beliefs: nodes,
    sources: allSources.map((s) => ({
      id: String(s._id),
      handle: s.handle,
      kind: s.kind,
      label: s.label,
      trust: Math.round(s.trust * 1000) / 1000,
      refuted_count: s.refuted_count,
      verified_count: s.verified_count,
      audience: Boolean(s.audience),
      belowFloor: s.trust < RETRIEVAL_FLOOR,
    })),
    actions: allActions.map((a) => ({
      id: String(a._id),
      kind: a.kind,
      status: a.status,
      payload: a.payload,
      used_beliefs: (a.used_beliefs || []).map(String),
    })),
    stats: {
      active: nodes.filter((n) => n.status === "active" && !n.inert).length,
      inert: nodes.filter((n) => n.inert).length,
      revoked: nodes.filter((n) => n.status === "revoked").length,
      quarantined: nodes.filter((n) => n.status === "quarantined").length,
      executed: allActions.filter((a) => a.status === "executed").length,
      reversed: allActions.filter((a) => a.status === "reversed").length,
    },
  };
}

function depthOf(belief, byId, seen = new Set()) {
  const parents = belief.derived_from || [];
  if (parents.length === 0) return 0;
  const key = String(belief._id);
  if (seen.has(key)) return 0;
  seen.add(key);
  const parent = byId.get(String(parents[0]));
  return parent ? 1 + depthOf(parent, byId, seen) : 1;
}

/**
 * Which branch a belief belongs to, walking up to its root.
 *
 * The wall needs this to keep the promise the whole demo rests on: the
 * contaminated subtree goes red and the unrelated one stays green. Colouring by
 * status alone would not survive a second attacker.
 */
function branchOf(belief, byId, sourceById, seen = new Set()) {
  const parents = belief.derived_from || [];
  if (parents.length === 0) {
    const src = sourceById.get(String(belief.source_id));
    return src?.audience ? `attack:${src.handle}` : "clean";
  }
  const key = String(belief._id);
  if (seen.has(key)) return "clean";
  seen.add(key);
  const parent = byId.get(String(parents[0]));
  return parent ? branchOf(parent, byId, sourceById, seen) : "clean";
}
