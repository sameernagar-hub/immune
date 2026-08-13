/**
 * Contradiction detection — a vector search against the belief collection itself.
 *
 * The unusual part, and the part worth saying out loud: the query vector *is* a
 * belief, and the corpus *is* the beliefs collection. Memory polices itself.
 *
 * Scoping by `subject_key` is what makes this tractable. Two beliefs can only
 * contradict if they are about the same thing, so the key bounds the comparison
 * and a fact about refunds is never weighed against a fact about shipping.
 *
 *   high similarity + same polarity + same indicators   -> duplicate, reinforce
 *   high similarity + opposite polarity                 -> conflict
 *   high similarity + disagreeing literal indicator     -> conflict
 *   low similarity                                      -> a new, unrelated belief
 */
import { collections } from "./db.js";
import { config } from "./config.js";
import { retrieve } from "./retrieve.js";
import { indicatorsConflict } from "./indicators.js";

export const SIMILARITY_FLOOR = 0.45;

export async function findContradictions({
  subjectKey,
  claim,
  polarity = 1,
  minTrust = config.minTrust,
  excludeId = null,
} = {}) {
  const { hits, mode } = await retrieve({
    query: claim,
    subjectKey,
    minTrust,
    limit: 10,
  });

  const conflicts = [];
  const duplicates = [];

  for (const hit of hits) {
    if (excludeId && String(hit._id) === String(excludeId)) continue;
    if (hit.score < SIMILARITY_FLOOR) continue;

    if (hit.polarity !== polarity) {
      conflicts.push({ ...hit, similarity: hit.score, why: "opposite polarity" });
      continue;
    }

    const { conflict, a, b } = indicatorsConflict(claim, hit.claim);
    if (conflict) {
      conflicts.push({
        ...hit,
        similarity: hit.score,
        why: "disagreeing literal indicator",
        incoming: a,
        stored: b,
      });
    } else {
      duplicates.push({ ...hit, similarity: hit.score });
    }
  }

  conflicts.sort((x, y) => y.similarity - x.similarity);
  duplicates.sort((x, y) => y.similarity - x.similarity);
  return { conflicts, duplicates, mode };
}

/** A duplicate from an independent source is weak corroboration, so nudge confidence. */
export async function reinforce(beliefId, by = 0.05) {
  const { beliefs } = await collections();
  const belief = await beliefs.findOne({ _id: beliefId });
  if (!belief) return null;
  const confidence = Math.min(1, Math.round((belief.confidence + by) * 1000) / 1000);
  await beliefs.updateOne({ _id: beliefId }, { $set: { confidence } });
  return { before: belief.confidence, after: confidence };
}
