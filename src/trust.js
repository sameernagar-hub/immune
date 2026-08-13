/**
 * Source trust — reputation, not a blocklist.
 *
 * Multiplicative decay on refutation, additive recovery on survival. A source
 * that lies once drops below the retrieval floor immediately; a source that
 * behaves earns its way back slowly, one survived check at a time.
 *
 * This asymmetry is the whole point, and it is what makes the cold re-run work:
 * the second attack fails because the sender's trust is 0.28 *in the database*,
 * not because anything about the attack is in the prompt.
 *
 *   trust 0.70  --refuted-->  0.28   (below the 0.5 floor: invisible to retrieval)
 *   0.28 needs 5 survived checks to climb back over the floor.
 */
export const DECAY_FACTOR = 0.4;
export const RECOVERY_STEP = 0.05;
export const RETRIEVAL_FLOOR = 0.5;

/** Applied when a source's claim is refuted by a trusted record. */
export function decay(trust) {
  return round(Math.max(0, trust * DECAY_FACTOR));
}

/** Applied when a claim from this source survives verification. */
export function recover(trust) {
  return round(Math.min(1, trust + RECOVERY_STEP));
}

export function isTrusted(trust, floor = RETRIEVAL_FLOOR) {
  return trust >= floor;
}

/** How many survived checks this source needs to become visible again. */
export function checksToRecover(trust, floor = RETRIEVAL_FLOOR) {
  if (trust >= floor) return 0;
  return Math.ceil((floor - trust) / RECOVERY_STEP);
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
