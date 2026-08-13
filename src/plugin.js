/**
 * Immune as a plugin.
 *
 * Everything else in this repository is a demonstration. This file is the
 * product: a memory adapter you drop into an agent you already have, in five
 * calls, without restructuring it.
 *
 *   const memory = await immune({ agent: "support-bot" });
 *
 *   await memory.remember({ from: "support-inbox", text: ticket });
 *   const facts = await memory.recall({ about: "refund.destination" });
 *   await memory.guard({ kind: "refund.payout", payload }, () => sendMoney(payload));
 *   await memory.challenge({ from: "ledger", about: "refund.destination", claim: truth });
 *   memory.on("revoked", (e) => console.log(e.claim));
 *
 * The design constraint is that an agent author should not have to understand
 * provenance graphs to get provenance. So the graph is a consequence of the
 * API's shape rather than something the caller maintains:
 *
 * - `remember` writes the source edge. There is no way to store a fact without
 *   saying where it came from, because the source is a required argument.
 * - `derive` writes the parent edges. A conclusion that came from other beliefs
 *   cannot be recorded without naming them.
 * - `guard` writes the action edge. It records which beliefs justified the
 *   action *before* running it, which is what makes reversal possible later.
 *
 * That last one is the whole trick. `guard` is not a permission check — it is
 * the thing that makes an action revocable. An agent that calls `guard` gets
 * the cascade for free, and an agent that skips it and calls the payment API
 * directly is exactly the agent this project is about.
 *
 * **Why this is a plugin and not a service.** There is no daemon, no sidecar and
 * no dashboard. Immune is a library over your own Atlas cluster: the beliefs are
 * your documents, the revocation is a write, and every process on the cluster —
 * including ones that were not running when it happened — learns through the
 * change stream. Nothing has to be told.
 */
import { collections, close as closeDb } from "./db.js";
import { ensureSchema } from "./schema.js";
import { recordBelief, listBeliefs, getBelief } from "./beliefs.js";
import { retrieve, awaitIndexed } from "./retrieve.js";
import { findContradictions } from "./contradict.js";
import { assessLoadBearing, verifyAgainstLedger } from "./verify.js";
import { quarantineAndCascade, traceContamination, cascadePipeline } from "./cascade.js";
import { execute } from "./act.js";
import { extractClaim } from "./extract.js";
import { startRun, finishRun, logEvent, integrityPass } from "./agent.js";
import { RETRIEVAL_FLOOR, decay, recover, checksToRecover } from "./trust.js";

/**
 * Every source starts here unless the caller says otherwise.
 *
 * Not 1.0. A source the agent has never seen is not trustworthy, it is merely
 * unrefuted, and starting new channels at the ceiling is how you build a system
 * that can only ever lose trust. 0.7 is above the retrieval floor — so a new
 * source *is* believed, which is the honest model of how this actually fails —
 * but one refutation puts it under.
 */
export const DEFAULT_SOURCE_TRUST = 0.7;

export async function immune({
  agent = "agent",
  minTrust = RETRIEVAL_FLOOR,
  autoSchema = true,
} = {}) {
  if (autoSchema) await ensureSchema();
  const { beliefs, sources, actions } = await collections();

  const listeners = new Map();
  let stream = null;

  /* ------------------------------------------------------------- sources */

  /**
   * Sources are upserted by handle, not created per call.
   *
   * A channel's reputation has to survive the process that observed it,
   * otherwise trust resets every time the agent restarts and the second attack
   * lands exactly like the first. This is the difference between reputation and
   * a session variable.
   */
  async function sourceFor(from, { kind = "external", trust = DEFAULT_SOURCE_TRUST } = {}) {
    if (from && typeof from === "object" && from._id) return from;
    const handle = String(from ?? "unknown");
    const existing = await sources.findOne({ handle });
    if (existing) return existing;
    const doc = {
      kind,
      handle,
      label: kind,
      trust,
      verified_count: 0,
      refuted_count: 0,
      first_seen: new Date(),
      last_updated: new Date(),
    };
    const { insertedId } = await sources.insertOne(doc);
    return { ...doc, _id: insertedId };
  }

  /* ------------------------------------------------------------ remember */

  /**
   * Store what a message asserts.
   *
   * Note what does not happen: no filter, no gate, no human. That is faithful
   * to the threat rather than a shortcut — memory poisoning is interesting
   * precisely because the write is indistinguishable from a legitimate one at
   * the moment it happens. Immune does not try to win at the door. It makes
   * what came through the door traceable and revocable.
   */
  async function remember({ from, text, subject = "", kind, trust, about = null, runId = null }) {
    const source = await sourceFor(from, { kind, trust });
    const extracted = await extractClaim({ subject, body: text }, { preferLlm: true });
    if (!extracted) return { stored: null, reason: "no claim extracted", source };

    const { conflicts, duplicates } = await findContradictions({
      subjectKey: about ?? extracted.subject_key,
      claim: extracted.claim,
      polarity: extracted.polarity,
      minTrust,
    });

    const belief = await recordBelief({
      subjectKey: about ?? extracted.subject_key,
      claim: extracted.claim,
      polarity: extracted.polarity,
      sourceId: source._id,
      derivedFrom: [],
      confidence: extracted.confidence,
      runId,
    });
    await awaitIndexed(belief);

    return {
      stored: belief,
      claim: belief.claim,
      about: belief.subject_key,
      source: { handle: source.handle, trust: source.trust },
      extraction: extracted.mode,
      conflicts,
      duplicates,
    };
  }

  /**
   * Record a conclusion the agent reasoned to, naming its parents.
   *
   * `from` is required and is the entire point. Without it there is a list of
   * beliefs and no way back from a bad one; with it there is a graph, and
   * `$graphLookup` can answer "what did this contaminate" in one query instead
   * of a guess.
   */
  async function derive({ from, about, claim, confidence = 0.6, by = agent, runId = null }) {
    const parents = (Array.isArray(from) ? from : [from]).map((p) => p?._id ?? p).filter(Boolean);
    if (parents.length === 0) throw new Error("derive() needs at least one parent belief");
    const source = await sourceFor(by, { kind: "agent", trust: 0.85 });
    const belief = await recordBelief({
      subjectKey: about,
      claim,
      polarity: 1,
      sourceId: source._id,
      derivedFrom: parents,
      confidence,
      runId,
    });
    await awaitIndexed(belief);
    return belief;
  }

  /* -------------------------------------------------------------- recall */

  /**
   * The read path, and the only one the agent should have.
   *
   * `excluded` is returned deliberately. Most memory layers make a filtered-out
   * document indistinguishable from a document that never existed, which means
   * an agent can never say *why* it doesn't know something. Here the caller can
   * see that three facts matched the question and were withheld because their
   * sources are below the floor — which is the difference between an agent that
   * forgot and an agent that declined.
   */
  async function recall({ about = null, query = null, limit = 8, floor = minTrust } = {}) {
    const { hits, mode, filter } = await retrieve({
      query: query ?? about ?? "",
      subjectKey: about,
      minTrust: floor,
      limit,
    });

    const suppressed = await beliefs
      .find(
        {
          ...(about ? { subject_key: about } : {}),
          $or: [{ status: { $ne: "active" } }, { source_trust: { $lt: floor } }],
        },
        { projection: { embedding: 0 } }
      )
      .limit(limit)
      .toArray();

    return {
      facts: hits,
      mode,
      filter,
      excluded: suppressed.map((b) => ({
        _id: b._id,
        claim: b.claim,
        why: b.status !== "active" ? b.status : `source below ${floor}`,
      })),
    };
  }

  /* --------------------------------------------------------------- guard */

  /**
   * Wrap a side-effectful action.
   *
   * Three things happen here that do not happen if the agent calls the payment
   * API directly:
   *
   *   1. It refuses when memory returns nothing trusted. Not "proceeds with an
   *      empty context" — refuses, and says why.
   *   2. It verifies, but only if the belief is load-bearing. We do not check
   *      everything, we check what is about to matter: a belief about to justify
   *      a side-effectful action, or with two or more children, or contradicting
   *      something already trusted.
   *   3. It records `used_beliefs` before running the effect, which is what lets
   *      the cascade reverse this action later. An action with no recorded
   *      justification cannot be un-decided, only apologised for.
   *
   * On refutation it does not run the effect at all — it quarantines, cascades,
   * and returns the diagnosis.
   */
  /**
   * A stored belief asserting the pre-action check has already been done.
   *
   * Matched semantically rather than by exact string, because the agent wrote
   * this belief in its own words — the attacker only planted the premise it was
   * derived from.
   */
  async function findSuppressor(floor) {
    const { hits } = await retrieve({
      query: "destination change review can be skipped, already verified",
      subjectKey: "refund.escalation",
      minTrust: floor,
      limit: 3,
    });
    return hits.find((h) => h.score > 0.4) ?? null;
  }

  async function settleRevocations(cascade) {
    const ids = [
      ...(cascade.revokedBeliefs ?? []).map((d) => d._id),
      cascade.quarantined?._id,
    ].filter(Boolean);
    if (ids.length === 0) return;
    const docs = await beliefs.find({ _id: { $in: ids } }).toArray();
    await awaitIndexed(docs, { expect: "absent" });
  }

  async function guard({ kind, payload, about, floor = minTrust, trustMemory = true }, effect) {
    const runId = await startRun(`guard:${kind}`);
    const trace = { kind, about, steps: [] };

    const { facts, filter, mode } = await recall({ about, query: kind, floor });
    trace.retrieval = { mode, filter, returned: facts.length };
    await logEvent(runId, "retrieve", { subject_key: about, mode, returned: facts.length });

    if (facts.length === 0) {
      await logEvent(runId, "refuse", { reason: "no trusted belief" });
      await finishRun(runId);
      return {
        ...trace,
        outcome: "refused",
        reason: "memory returned no trusted belief for this subject",
        ran: false,
      };
    }

    const belief = await getBelief(facts[0]._id);
    const assessment = await assessLoadBearing(belief, { pendingAction: { kind } });
    trace.assessment = assessment;
    await logEvent(runId, "assess", {
      belief_id: belief._id,
      load_bearing: assessment.loadBearing,
      reasons: assessment.reasons,
    });

    /**
     * Does memory already contain a belief saying this check is unnecessary?
     *
     * This is not a bug left in for the demo — it is the thing that makes memory
     * poisoning different in kind from prompt injection. The payload does not
     * bypass one check; it installs a standing belief that the check is not
     * needed, and the agent honours it on every future run, from a cold context,
     * with the original message long gone.
     *
     * A plugin that ignored this would be modelling an attack nobody suffers.
     * The answer is not a hard-coded exception: the suppressing belief is itself
     * a node in the provenance graph, so when its ancestor is refuted it is
     * revoked with everything else and the check switches back on by itself.
     * Pass `trustMemory: false` to make `guard` unsuppressible.
     */
    const suppressor = trustMemory ? await findSuppressor(floor) : null;

    if (assessment.loadBearing && suppressor) {
      trace.suppressedBy = { _id: suppressor._id, claim: suppressor.claim };
      await logEvent(runId, "verify", {
        belief_id: belief._id,
        outcome: "skipped",
        suppressed_by: suppressor._id,
      });
    } else if (assessment.loadBearing) {
      const verification = verifyAgainstLedger(belief);
      trace.verification = verification;
      await logEvent(runId, "verify", { belief_id: belief._id, verdict: verification.verdict });

      if (verification.verdict === "refuted") {
        const cascade = await quarantineAndCascade({
          beliefId: belief._id,
          evidenceRunId: runId,
          reason: `refuted by ${verification.source}: ${verification.detail}`,
        });
        await logEvent(runId, "cascade", {
          belief_id: belief._id,
          already_handled: Boolean(cascade.alreadyHandled),
          revoked: cascade.revokedBeliefs?.length ?? 0,
        });
        // Wait until the revoked set is absent from the *real* retrieval filter,
        // not merely updated in the collection. Skipping this leaves the search
        // index briefly still returning a quarantined belief as active, which
        // sends the next trigger back into a cascade that has already run.
        await settleRevocations(cascade);
        await finishRun(runId);
        return { ...trace, outcome: "blocked", cascade, ran: false };
      }
    }

    // Justification is recorded *before* the effect runs. If the process dies
    // between the two, the action is absent and the beliefs are intact — the
    // safe direction to fail in.
    const action = await execute({
      kind,
      payload,
      usedBeliefs: facts.map((f) => f._id),
      runId,
    });

    let result;
    try {
      result = typeof effect === "function" ? await effect(facts) : undefined;
    } catch (err) {
      await actions.updateOne({ _id: action._id }, { $set: { status: "failed", error: err.message } });
      await finishRun(runId);
      throw err;
    }

    await logEvent(runId, "act", { action_id: action._id, kind });
    await finishRun(runId);
    return { ...trace, outcome: "executed", action, result, ran: true };
  }

  /* ----------------------------------------------------------- challenge */

  /**
   * A trusted source states something that collides with what is believed.
   *
   * This trigger is deliberately **not suppressible**. A stored belief can talk
   * the agent out of a pre-action check — that is the attack — but nothing a
   * belief says can stop two contradictory records being compared. That
   * asymmetry is the escape hatch: it is how a poisoned agent recovers without
   * a human noticing first.
   */
  async function challenge({ from = "system-of-record", about, claim, polarity = 1 }) {
    await sourceFor(from, { kind: "tool", trust: 0.98 });
    const runId = await startRun("challenge");
    const { conflicts, resolved } = await integrityPass({
      runId,
      subjectKey: about,
      incomingClaim: claim,
      incomingPolarity: polarity,
    });

    const cascades = resolved.filter((r) => r.cascade && !r.cascade.alreadyHandled);
    const revoked = [];
    for (const r of cascades) {
      for (const d of r.cascade.revokedBeliefs) {
        const doc = await beliefs.findOne({ _id: d._id });
        if (doc) revoked.push(doc);
      }
      const root = await beliefs.findOne({ _id: r.belief._id });
      if (root) revoked.push(root);
    }
    await awaitIndexed(revoked, { expect: "absent" });
    await finishRun(runId);

    return {
      conflicts: conflicts.length,
      quarantined: cascades.length,
      revoked: cascades.flatMap((r) => r.cascade.revokedBeliefs),
      reversed: cascades.flatMap((r) => r.cascade.reversedActions),
      trust: cascades.map((r) => r.cascade.sourceTrust),
      pipeline: cascades[0]?.cascade.pipeline ?? null,
    };
  }

  /* ------------------------------------------------------------- explain */

  /**
   * "What did you believe, why, and what changed your mind?"
   *
   * Answerable only because nothing is ever deleted. A quarantined belief keeps
   * its claim, its source, the reason it was quarantined and the run that
   * refuted it — so the agent can account for a decision it no longer stands
   * by. Deleting would be amnesia; this is a memory of having been lied to.
   */
  async function explain(beliefOrId) {
    const id = beliefOrId?._id ?? beliefOrId;
    const belief = await getBelief(id);
    if (!belief) return null;
    const source = await sources.findOne({ _id: belief.source_id });
    const { contaminated } = await traceContamination(id);
    const parents = await beliefs
      .find({ _id: { $in: belief.derived_from || [] } }, { projection: { embedding: 0 } })
      .toArray();
    const justified = await actions.find({ used_beliefs: id }).toArray();

    return {
      claim: belief.claim,
      about: belief.subject_key,
      status: belief.status,
      believedFrom: belief.valid_from,
      believedUntil: belief.valid_to,
      because: parents.map((p) => ({ claim: p.claim, status: p.status })),
      source: source && {
        handle: source.handle,
        kind: source.kind,
        trust: source.trust,
        belowFloor: source.trust < minTrust,
        checksToRecover: checksToRecover(source.trust, minTrust),
      },
      quarantinedBecause: belief.quarantined_by,
      wouldContaminate: contaminated.map((d) => ({ claim: d.claim, depth: d.distance })),
      justifiedActions: justified.map((a) => ({ kind: a.kind, status: a.status })),
      pipeline: cascadePipeline(id),
    };
  }

  /* -------------------------------------------------------------- events */

  /**
   * Live, and not a dashboard.
   *
   * The events come off a change stream on the cluster, so a *different
   * process* — one holding no conversation, no context and no memory of the
   * attack — is notified the moment a belief is revoked. That is the argument
   * for putting revocation in the database rather than in an orchestrator's
   * working state: if it lived in a prompt, every other agent would go on
   * believing the lie until somebody thought to tell it.
   *
   * Falls back to a poll if the deployment has no oplog, and reports which one
   * it is using rather than degrading quietly.
   */
  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    startStream();
    return () => listeners.get(event)?.delete(handler);
  }

  function emit(event, payload) {
    for (const h of listeners.get(event) ?? []) {
      try {
        h(payload);
      } catch {
        /* a listener throwing must not take the stream down */
      }
    }
    for (const h of listeners.get("*") ?? []) {
      try {
        h({ event, ...payload });
      } catch {
        /* as above */
      }
    }
  }

  /**
   * Last status announced per belief.
   *
   * The stream reports *writes*, not state changes, and one cascade writes a
   * belief more than once: the quarantine sets the status, then the denormalised
   * trust re-stamp touches the same document again. Both events carry
   * `status: "quarantined"`, so a naive handler announces the same revocation
   * twice — which on a projector reads as the cascade having run twice.
   */
  const announced = new Map();

  function startStream() {
    if (stream) return;
    try {
      stream = beliefs.watch([], { fullDocument: "updateLookup" });
      stream.on("change", (change) => {
        const doc = change.fullDocument;
        if (!doc) return;
        const key = String(doc._id);
        if (change.operationType === "insert") {
          announced.set(key, "active");
          emit("remembered", { _id: doc._id, claim: doc.claim, about: doc.subject_key });
          return;
        }
        if (announced.get(key) === doc.status) return; // a re-write, not a transition
        announced.set(key, doc.status);
        if (doc.status === "revoked") {
          emit("revoked", { _id: doc._id, claim: doc.claim, revokedBy: doc.revoked_by });
        } else if (doc.status === "quarantined") {
          emit("quarantined", { _id: doc._id, claim: doc.claim, why: doc.quarantined_by });
        }
      });
      stream.on("error", () => {
        stream = null;
        emit("degraded", { propagation: "poll" });
      });
    } catch {
      stream = null;
      emit("degraded", { propagation: "unavailable" });
    }
  }

  /* --------------------------------------------------------------- misc */

  async function state() {
    const all = await listBeliefs({});
    return {
      floor: minTrust,
      believed: all.filter((b) => b.status === "active" && b.source_trust >= minTrust).length,
      inert: all.filter((b) => b.status === "active" && b.source_trust < minTrust).length,
      revoked: all.filter((b) => b.status === "revoked").length,
      quarantined: all.filter((b) => b.status === "quarantined").length,
    };
  }

  async function close() {
    try {
      await stream?.close();
    } catch {
      /* already gone */
    }
    await closeDb();
  }

  return {
    agent,
    floor: minTrust,
    remember,
    derive,
    recall,
    guard,
    challenge,
    explain,
    on,
    state,
    close,
    /** Escape hatch: the raw collections, for anything this API does not cover. */
    raw: { beliefs, sources, actions },
    trust: { decay, recover, floor: RETRIEVAL_FLOOR },
  };
}

export default immune;
