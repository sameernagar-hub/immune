/**
 * Belief writes.
 *
 * Every belief carries two things a normal memory row does not: the source it
 * came from, and the beliefs it was reasoned from. `derived_from` is a real
 * edge list of ObjectIds, which is what turns "find everything contaminated by
 * this lie" from a guess into a graph traversal.
 *
 * Nothing here ever deletes. A belief that turns out to be false gets a
 * `status` and a `valid_to`, so the agent can still answer "what did you
 * believe on Tuesday, and what changed your mind?". Deleting is amnesia; this
 * is a memory of having been lied to.
 */
import { collections } from "./db.js";
import { embed } from "./embed.js";

/**
 * `source_trust` is denormalised onto every belief.
 *
 * It duplicates `sources.trust`, which would normally be a smell. It is here
 * because Atlas Vector Search pre-filters on fields of the searched documents:
 * a filter on a joined collection is not available inside `$vectorSearch`. So
 * the choice is denormalise, or do the semantic search first and filter after
 * — which silently starves the result set, because the trust filter would be
 * applied to an already-truncated `limit`.
 *
 * The cost is a write amplification of one `updateMany` whenever a source's
 * trust changes. `src/trust.js` changes trust exactly twice in the demo, so
 * that is a good trade. `syncSourceTrust` below is the thing that pays it.
 */
export async function recordBelief({
  subjectKey,
  claim,
  polarity = 1,
  sourceId,
  derivedFrom = [],
  confidence = 0.5,
  originTicket = null,
  runId = null,
}) {
  const { beliefs, sources } = await collections();

  const source = await sources.findOne({ _id: sourceId });
  if (!source) throw new Error(`unknown source ${sourceId}`);

  const doc = {
    subject_key: subjectKey,
    claim,
    polarity,
    embedding: await embed(`${subjectKey}: ${claim}`),
    source_id: sourceId,
    source_trust: source.trust,
    derived_from: derivedFrom,
    status: "active",
    confidence,
    valid_from: new Date(),
    valid_to: null,
    quarantined_by: null,
    quarantined_at: null,
    revoked_by: null,
    evidence_run_id: null,
    origin_ticket: originTicket,
    created_by_run: runId,
  };

  const { insertedId } = await beliefs.insertOne(doc);
  return { ...doc, _id: insertedId };
}

/** Re-stamps denormalised trust after a source's reputation moves. */
export async function syncSourceTrust(sourceId, trust) {
  const { beliefs } = await collections();
  const res = await beliefs.updateMany(
    { source_id: sourceId },
    { $set: { source_trust: trust } }
  );
  return res.modifiedCount;
}

export async function getBelief(id) {
  const { beliefs } = await collections();
  return beliefs.findOne({ _id: id });
}

export async function listBeliefs(filter = {}) {
  const { beliefs } = await collections();
  return beliefs
    .find(filter, { projection: { embedding: 0 } })
    .sort({ valid_from: 1 })
    .toArray();
}

/**
 * Direct children of a belief — one hop down the provenance tree.
 * Used by the load-bearing test in src/verify.js, not by the cascade.
 */
export async function childrenOf(id) {
  const { beliefs } = await collections();
  return beliefs.find({ derived_from: id }, { projection: { embedding: 0 } }).toArray();
}

export async function countActive() {
  const { beliefs } = await collections();
  return beliefs.countDocuments({ status: "active" });
}
