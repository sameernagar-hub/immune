/**
 * Collections and indexes.
 *
 * Four collections, a handful of B-tree indexes, and one Atlas Vector Search
 * index. The vector index is created first and everything else happens while it
 * builds, because it takes roughly forty seconds to become queryable and that
 * is forty seconds of the build window if you wait for it serially.
 */
import { collections } from "./db.js";
import { config, COLLECTIONS } from "./config.js";

export const VECTOR_INDEX_DEFINITION = {
  name: config.vectorIndex,
  type: "vectorSearch",
  definition: {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: config.embedding.dimensions,
        similarity: "cosine",
      },
      // These three must be declared as `filter` fields or the pre-filter in
      // src/retrieve.js is rejected at query time. Declaring them here is what
      // makes trust-filtered retrieval a single index-backed operation rather
      // than a semantic search followed by a filter in application code.
      { type: "filter", path: "status" },
      { type: "filter", path: "source_trust" },
      { type: "filter", path: "subject_key" },
    ],
  },
};

export async function ensureCollections() {
  const { db } = await collections();
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  );
  const created = [];
  for (const name of COLLECTIONS) {
    if (!existing.has(name)) {
      await db.createCollection(name);
      created.push(name);
    }
  }
  return created;
}

export async function ensureIndexes() {
  const { beliefs, sources, actions } = await collections();

  await beliefs.createIndexes([
    // The provenance edge list. Every cascade traversal hops on this index.
    { key: { derived_from: 1 }, name: "provenance_edge" },
    { key: { subject_key: 1, status: 1 }, name: "subject_status" },
    { key: { source_id: 1 }, name: "by_source" },
    { key: { status: 1, source_trust: -1 }, name: "trust_gate" },
  ]);

  await sources.createIndexes([
    { key: { handle: 1 }, name: "handle", unique: true },
    { key: { trust: -1 }, name: "by_trust" },
  ]);

  await actions.createIndexes([
    { key: { used_beliefs: 1 }, name: "justified_by" },
    { key: { run_id: 1 }, name: "by_run" },
  ]);
}

/**
 * Creates the vector index if it is absent. Returns immediately — call
 * `waitForVectorIndex` separately so the ~40 s build overlaps with other work.
 */
export async function ensureVectorIndex() {
  const { beliefs } = await collections();
  try {
    const existing = await beliefs.listSearchIndexes().toArray();
    const match = existing.find((i) => i.name === config.vectorIndex);
    if (match) return { created: false, status: match.status };
    await beliefs.createSearchIndex(VECTOR_INDEX_DEFINITION);
    return { created: true, status: "PENDING" };
  } catch (err) {
    // Search indexes are an Atlas feature. On a local deployment without it,
    // retrieval falls back to the aggregation path in src/retrieve.js.
    return { created: false, status: "UNAVAILABLE", error: err.message };
  }
}

export async function vectorIndexStatus() {
  const { beliefs } = await collections();
  try {
    const list = await beliefs.listSearchIndexes().toArray();
    const match = list.find((i) => i.name === config.vectorIndex);
    if (!match) return "MISSING";
    return match.queryable ? "READY" : match.status || "PENDING";
  } catch {
    return "UNAVAILABLE";
  }
}

export async function waitForVectorIndex({ timeoutMs = 120000, onTick } = {}) {
  const started = Date.now();
  for (;;) {
    const status = await vectorIndexStatus();
    if (status === "READY") return { ready: true, waitedMs: Date.now() - started };
    if (status === "UNAVAILABLE" || status === "MISSING") {
      return { ready: false, status, waitedMs: Date.now() - started };
    }
    if (Date.now() - started > timeoutMs) {
      return { ready: false, status, waitedMs: Date.now() - started };
    }
    if (onTick) onTick(Math.round((Date.now() - started) / 1000), status);
    await sleep(3000);
  }
}

export async function ensureSchema() {
  // Collections first: a search index cannot be created on a collection that
  // does not exist yet. Then fire the vector index build and let the B-tree
  // indexes be created while it works, because it is the slow one by two
  // orders of magnitude.
  const created = await ensureCollections();
  const vector = await ensureVectorIndex();
  await ensureIndexes();
  return { created, vector };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
