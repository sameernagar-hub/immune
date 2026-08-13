/**
 * The revocation cascade — the technical heart of Immune.
 *
 * When a belief fails verification, wiping the memory is easy and useless. The
 * hard question is *which* of the agent's other conclusions inherited the lie,
 * and the answer is a graph traversal: walk the provenance edges downward from
 * the poisoned belief and revoke exactly what you reach.
 *
 * Anyone can reset a memory. Only a provenance graph can say that these three
 * are contaminated and those three are fine — and the second half of that
 * sentence is the product.
 */
import { collections, getDb } from "./db.js";
import { decay, recover } from "./trust.js";
import { syncSourceTrust } from "./beliefs.js";

/**
 * The traversal.
 *
 * Direction is the one thing to get right and the easiest thing to get wrong:
 *
 *   connectFromField: "_id"            take this document's id
 *   connectToField:   "derived_from"   and find documents that list it as a parent
 *
 * Swapping those two walks *up* the tree to ancestors and returns an empty set
 * for a root belief, which looks like "the cascade is broken" and is not.
 */
export function cascadePipeline(beliefId) {
  return [
    { $match: { _id: beliefId } },
    {
      $graphLookup: {
        from: "beliefs",
        startWith: "$_id",
        connectFromField: "_id",
        connectToField: "derived_from",
        as: "contaminated",
        maxDepth: 6,
        depthField: "distance",
      },
    },
    {
      $project: {
        _id: 1,
        claim: 1,
        subject_key: 1,
        source_id: 1,
        contaminated: {
          $map: {
            input: "$contaminated",
            as: "d",
            in: {
              _id: "$$d._id",
              claim: "$$d.claim",
              subject_key: "$$d.subject_key",
              status: "$$d.status",
              distance: "$$d.distance",
            },
          },
        },
      },
    },
  ];
}

/**
 * Read-only: what *would* be revoked. Used by the demo to show the blast
 * radius before anything is written, and by `npm run inspect`.
 */
export async function traceContamination(beliefId) {
  const { beliefs } = await collections();
  const [result] = await beliefs.aggregate(cascadePipeline(beliefId)).toArray();
  if (!result) return { root: null, contaminated: [] };
  const contaminated = [...result.contaminated].sort(
    (a, b) => a.distance - b.distance || String(a._id).localeCompare(String(b._id))
  );
  return { root: result, contaminated };
}

/**
 * Quarantine a belief and revoke everything downstream of it.
 *
 * Four writes, in a fixed order, in one transaction where the deployment
 * supports it:
 *
 *   1. every descendant  -> revoked, valid_to = now, revoked_by = poisoned id
 *   2. the poisoned belief -> quarantined (not revoked: it is evidence, and the
 *      agent should be able to say what it used to believe and why it stopped)
 *   3. every action whose used_beliefs intersect the contaminated set -> reversed
 *   4. the source -> trust decayed, and the denormalised copy re-stamped
 *
 * The order matters on the fallback path: it is the order in which a partial
 * failure leaves the database in a state that is safe to re-run, because every
 * step is idempotent.
 */
export async function quarantineAndCascade({ beliefId, evidenceRunId = null, reason = "failed verification" }) {
  const { db, beliefs, actions, sources } = await collections();
  const { client } = await getDb();

  const existing = await beliefs.findOne({ _id: beliefId }, { projection: { status: 1 } });
  if (!existing) throw new Error(`belief ${beliefId} not found`);
  // Guard: a belief is quarantined once. Without this, a second trigger firing
  // on the same belief decays the source a second time (0.7 -> 0.28 -> 0.112)
  // and the demo's trust figure stops being reproducible.
  if (existing.status !== "active") {
    return { alreadyHandled: true, status: existing.status, pipeline: cascadePipeline(beliefId) };
  }

  const { root, contaminated } = await traceContamination(beliefId);
  if (!root) throw new Error(`belief ${beliefId} not found`);

  const descendantIds = contaminated.map((d) => d._id);
  const contaminatedSet = [beliefId, ...descendantIds];
  const now = new Date();

  const affectedActions = await actions
    .find({ used_beliefs: { $in: contaminatedSet }, status: "executed" })
    .toArray();

  const source = await sources.findOne({ _id: root.source_id });
  const trustBefore = source?.trust ?? 0;
  const trustAfter = decay(trustBefore);

  const apply = async (session) => {
    const opts = session ? { session } : {};

    if (descendantIds.length) {
      await beliefs.updateMany(
        { _id: { $in: descendantIds }, status: { $ne: "revoked" } },
        {
          $set: {
            status: "revoked",
            valid_to: now,
            revoked_by: beliefId,
            evidence_run_id: evidenceRunId,
          },
        },
        opts
      );
    }

    await beliefs.updateOne(
      { _id: beliefId },
      {
        $set: {
          status: "quarantined",
          valid_to: now,
          quarantined_by: reason,
          quarantined_at: now,
          evidence_run_id: evidenceRunId,
        },
      },
      opts
    );

    if (affectedActions.length) {
      await actions.updateMany(
        { _id: { $in: affectedActions.map((a) => a._id) } },
        {
          $set: {
            status: "reversed",
            reversed_at: now,
            reversed_by: beliefId,
            evidence_run_id: evidenceRunId,
          },
        },
        opts
      );
    }

    await sources.updateOne(
      { _id: root.source_id },
      {
        $set: { trust: trustAfter, last_updated: now },
        $inc: { refuted_count: 1 },
      },
      opts
    );
  };

  let transactional = true;
  const session = client.startSession();
  try {
    await session.withTransaction(apply, {
      readConcern: { level: "local" },
      writeConcern: { w: "majority" },
    });
  } catch (err) {
    // Fallback rung: sequential idempotent updates in the same fixed order.
    // Every step is a $set to a terminal state, so re-running after a partial
    // failure converges rather than compounding.
    transactional = false;
    await apply(null);
  } finally {
    await session.endSession();
  }

  // Outside the transaction: re-stamp the denormalised trust so the retrieval
  // pre-filter sees the downgrade. Idempotent, and safe to repeat.
  const restamped = await syncSourceTrust(root.source_id, trustAfter);

  return {
    quarantined: { _id: beliefId, claim: root.claim, subject_key: root.subject_key },
    revokedBeliefs: contaminated,
    reversedActions: affectedActions.map((a) => ({
      _id: a._id,
      kind: a.kind,
      payload: a.payload,
    })),
    sourceTrust: {
      _id: root.source_id,
      handle: source?.handle,
      before: trustBefore,
      after: trustAfter,
    },
    beliefsRestamped: restamped,
    transactional,
    pipeline: cascadePipeline(beliefId),
  };
}

/** Reputation repair: a source whose claim survived a check earns a little back. */
export async function creditSource(sourceId) {
  const { sources } = await collections();
  const source = await sources.findOne({ _id: sourceId });
  if (!source) return null;
  const after = recover(source.trust);
  await sources.updateOne(
    { _id: sourceId },
    { $set: { trust: after, last_updated: new Date() }, $inc: { verified_count: 1 } }
  );
  await syncSourceTrust(sourceId, after);
  return { before: source.trust, after };
}
