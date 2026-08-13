/**
 * Embeddings, with a deterministic fallback.
 *
 * Rung 1: a real embedding provider, when a key is present.
 * Rung 2: the deterministic lexical embedder below — no network, no key, and
 *         byte-identical output on every run.
 *
 * Rung 2 is not a stub. It is a hashed bag of word unigrams, word bigrams and
 * character 4-grams, projected into a fixed 256-dimensional space with signed
 * hashing and L2-normalised, which is the standard "hashing trick". It gives
 * real lexical similarity — enough for claims that share a `subject_key`, which
 * is the only comparison mechanism ② ever makes — and it is why this demo runs
 * with the venue wifi switched off and produces the same numbers every time.
 *
 * The dimension is pinned in config so swapping providers can never silently
 * mismatch the vector index.
 */
import { config } from "./config.js";

const DIM = config.embedding.dimensions;
const cache = new Map();

let providerState = config.embedding.apiKey ? "untried" : "absent";

export function embeddingMode() {
  return providerState === "live" ? "provider" : "deterministic-lexical";
}

export async function embed(text) {
  const key = String(text ?? "");
  if (cache.has(key)) return cache.get(key);

  let vector = null;
  if (providerState === "untried" || providerState === "live") {
    vector = await remoteEmbed(key);
  }
  if (!vector) vector = lexicalEmbed(key);

  cache.set(key, vector);
  return vector;
}

export async function embedMany(texts) {
  return Promise.all(texts.map(embed));
}

async function remoteEmbed(text) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.embedding.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.embedding.model,
        input: text,
        dimensions: DIM,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const vector = json?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== DIM) {
      throw new Error(`unexpected dimension ${vector?.length}`);
    }
    providerState = "live";
    return normalise(vector);
  } catch {
    // One failure demotes the provider for the rest of the process. Retrying a
    // dead endpoint per belief would add seconds to every run of the demo.
    providerState = "down";
    return null;
  }
}

/** Deterministic lexical embedding — the offline path. */
export function lexicalEmbed(text) {
  const vector = new Array(DIM).fill(0);
  const normalised = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const words = normalised.split(" ").filter(Boolean);

  for (const w of words) add(vector, `w:${w}`, 1.0);
  for (let i = 0; i < words.length - 1; i++) {
    add(vector, `b:${words[i]}_${words[i + 1]}`, 0.7);
  }
  const joined = normalised.replace(/ /g, "_");
  for (let i = 0; i + 4 <= joined.length; i++) {
    add(vector, `c:${joined.slice(i, i + 4)}`, 0.35);
  }

  return normalise(vector);
}

function add(vector, token, weight) {
  const h = fnv1a(token);
  const bucket = h % DIM;
  const sign = (h >>> 31) & 1 ? -1 : 1; // signed hashing cancels collisions
  vector[bucket] += sign * weight;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function normalise(vector) {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const mag = Math.sqrt(sum);
  if (mag === 0) return vector.map(() => 0);
  return vector.map((v) => round(v / mag));
}

/** Cosine similarity of two unit vectors is their dot product. */
export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
