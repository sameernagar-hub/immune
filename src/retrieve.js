/**
 * Trust-filtered retrieval — the mechanism that satisfies the hackathon brief.
 *
 * The brief asks that what you store and retrieve *changes what the system does
 * next*, not just fills the prompt. This is that, literally: the agent asks
 * memory the same question before and after a quarantine and gets a different
 * answer, because the filter reads state that changed in the database. Nothing
 * in the prompt moved.
 *
 * The pre-filter is the feature, not a detail. Semantic recall that respects
 * trust state has to happen *inside* the index — filtering after the fact means
 * the `limit` is spent on documents you were always going to throw away, and a
 * quarantined belief crowds out the good one that should have replaced it.
 */
import { collections } from "./db.js";
import { config } from "./config.js";
import { embed, cosine } from "./embed.js";
import { vectorIndexStatus } from "./schema.js";

let cachedMode = null;

/** `vector` when the index is queryable, `scan` otherwise. */
export async function retrievalMode({ recheck = false } = {}) {
  if (cachedMode && !recheck) return cachedMode;
  cachedMode = (await vectorIndexStatus()) === "READY" ? "vector" : "scan";
  return cachedMode;
}

export function retrievalPipeline({ queryVector, subjectKey, minTrust, limit }) {
  const filter = { status: "active", source_trust: { $gte: minTrust } };
  if (subjectKey) filter.subject_key = subjectKey;

  return [
    {
      $vectorSearch: {
        index: config.vectorIndex,
        path: "embedding",
        queryVector,
        numCandidates: Math.max(100, limit * 20),
        limit,
        filter,
      },
    },
    {
      $project: {
        _id: 1,
        claim: 1,
        subject_key: 1,
        polarity: 1,
        status: 1,
        confidence: 1,
        source_id: 1,
        source_trust: 1,
        derived_from: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];
}

/**
 * Returns only `active` beliefs from sources at or above `minTrust`.
 *
 * A quarantined belief, or one whose source has been downgraded below the
 * floor, is invisible here — not deleted, not special-cased in application
 * code, just outside the filter.
 */
export async function retrieve({
  query,
  subjectKey = null,
  minTrust = config.minTrust,
  limit = 8,
} = {}) {
  const { beliefs } = await collections();
  const queryVector = await embed(subjectKey ? `${subjectKey}: ${query}` : query);
  const mode = await retrievalMode();

  if (mode === "vector") {
    try {
      const hits = await beliefs
        .aggregate(retrievalPipeline({ queryVector, subjectKey, minTrust, limit }))
        .toArray();
      return { mode: "vector", hits, filter: describeFilter(subjectKey, minTrust) };
    } catch (err) {
      // Rung 2: the index exists but rejected the query — most often because a
      // filter path was not declared as a `filter` field. Fall through rather
      // than fail the run; the README says which path was taken.
      cachedMode = "scan";
    }
  }

  // Rung 3: the same semantics without the index. `$match` applies the identical
  // structural filter, then ranking happens over the filtered set — so the trust
  // gate is still applied *before* truncation, which is the property that matters.
  const filter = { status: "active", source_trust: { $gte: minTrust } };
  if (subjectKey) filter.subject_key = subjectKey;

  const candidates = await beliefs.find(filter).limit(200).toArray();
  const hits = candidates
    .map((b) => ({
      _id: b._id,
      claim: b.claim,
      subject_key: b.subject_key,
      polarity: b.polarity,
      status: b.status,
      confidence: b.confidence,
      source_id: b.source_id,
      source_trust: b.source_trust,
      derived_from: b.derived_from,
      score: cosine(queryVector, b.embedding || []),
    }))
    .sort((a, b) => b.score - a.score || String(a._id).localeCompare(String(b._id)))
    .slice(0, limit);

  return { mode: "scan", hits, filter: describeFilter(subjectKey, minTrust) };
}

function describeFilter(subjectKey, minTrust) {
  const filter = { status: "active", source_trust: { $gte: minTrust } };
  if (subjectKey) filter.subject_key = subjectKey;
  return filter;
}

/**
 * Block until freshly written beliefs are visible to the vector index.
 *
 * Atlas Search indexes are updated asynchronously, so a belief written a
 * moment ago is durably in the collection but not yet in the index. For an
 * ordinary application that is invisible. For this demo it is fatal in a
 * specific and confusing way: the agent derives a belief, immediately asks
 * memory whether that belief exists, gets told no, and takes a *different
 * branch*. The run then differs between rehearsal and filming for reasons that
 * have nothing to do with the logic being demonstrated.
 *
 * So the agent waits for its own writes to become retrievable before it reads
 * back. This is read-your-writes consistency, made explicit rather than hoped
 * for, and it is what makes two consecutive runs identical.
 */
export async function awaitIndexed(
  docs,
  { expect = "present", timeoutMs = 25000, intervalMs = 350 } = {}
) {
  const list = (Array.isArray(docs) ? docs : [docs]).filter((d) => d && d.embedding);
  if (list.length === 0) return { settled: true, waitedMs: 0 };
  if ((await retrievalMode()) !== "vector") return { settled: true, waitedMs: 0 };

  const { beliefs } = await collections();
  const pending = new Map(list.map((d) => [String(d._id), d]));
  const started = Date.now();

  while (pending.size && Date.now() - started < timeoutMs) {
    for (const [id, doc] of [...pending]) {
      // `absent` asks the *real* retrieval filter, not a bare lookup: what
      // matters after a revocation is not that the document changed, it is
      // that the query the agent actually runs stops returning it.
      const stages =
        expect === "absent"
          ? retrievalPipeline({
              queryVector: doc.embedding,
              subjectKey: doc.subject_key,
              minTrust: config.minTrust,
              limit: 20,
            })
          : [
              {
                $vectorSearch: {
                  index: config.vectorIndex,
                  path: "embedding",
                  queryVector: doc.embedding,
                  numCandidates: 100,
                  limit: 20,
                  filter: { subject_key: doc.subject_key },
                },
              },
              { $project: { _id: 1 } },
            ];

      const hits = await beliefs.aggregate(stages).toArray();
      const found = hits.some((h) => String(h._id) === id);
      if (expect === "absent" ? !found : found) pending.delete(id);
    }
    if (pending.size) await sleep(intervalMs);
  }

  return {
    settled: pending.size === 0,
    waitedMs: Date.now() - started,
    unsettled: [...pending.keys()],
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Diagnostic: retrieval with the trust gate removed, to show what it was hiding. */
export async function retrieveUnfiltered({ query, subjectKey = null, limit = 8 } = {}) {
  const { beliefs } = await collections();
  const queryVector = await embed(subjectKey ? `${subjectKey}: ${query}` : query);
  const filter = subjectKey ? { subject_key: subjectKey } : {};
  const candidates = await beliefs.find(filter).limit(200).toArray();
  return candidates
    .map((b) => ({
      _id: b._id,
      claim: b.claim,
      subject_key: b.subject_key,
      status: b.status,
      source_trust: b.source_trust,
      score: cosine(queryVector, b.embedding || []),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
