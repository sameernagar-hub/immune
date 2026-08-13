/**
 * Literal indicator extraction.
 *
 * Embeddings are good at meaning and bad at literal strings. "Refunds go to
 * GB29 4471 8829" and "Refunds go to GB29 9021 3345" are almost identical
 * vectors and completely opposite facts, and that gap is exactly where a
 * memory system embarrasses itself.
 *
 * So contradiction detection runs on both channels: the vector says these two
 * beliefs are *about the same thing*, and the indicators say they *disagree*.
 * Meaning finds the pair; the literal decides the verdict.
 */

const PATTERNS = [
  // IBAN-ish: two letters, two digits, then grouped alphanumerics.
  { kind: "iban", re: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{2,4}){2,7}\b/g },
  // Account handles like ACME-1042.
  { kind: "account", re: /\b[A-Z]{2,8}-\d{2,8}\b/g },
  // Bare long digit runs — card-like or account-like.
  { kind: "number", re: /\b\d{6,}\b/g },
  // URLs and hostnames.
  { kind: "host", re: /\b(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+){1,4}\b(?=[^@]|$)/gi },
];

/** Normalises for comparison: case-folded, separators stripped. */
export function normaliseIndicator(value) {
  return String(value).toUpperCase().replace(/[\s-]/g, "");
}

export function extractIndicators(text) {
  const found = new Map();
  const upper = String(text ?? "");
  for (const { kind, re } of PATTERNS) {
    for (const match of upper.matchAll(re)) {
      const raw = match[0];
      const key = `${kind}:${normaliseIndicator(raw)}`;
      if (!found.has(key)) found.set(key, { kind, raw, value: normaliseIndicator(raw) });
    }
  }
  return [...found.values()];
}

/** The indicators that decide a subject — the ones the two claims should agree on. */
export function decisiveIndicators(text) {
  return extractIndicators(text).filter((i) => i.kind === "iban" || i.kind === "number");
}

/**
 * Do two claims about the same subject disagree on a literal?
 *
 * Only a decision when both sides actually carry a decisive indicator. Absence
 * of evidence is not disagreement — a claim with no IBAN in it does not
 * contradict one that has an IBAN.
 */
export function indicatorsConflict(claimA, claimB) {
  const a = decisiveIndicators(claimA).map((i) => i.value);
  const b = decisiveIndicators(claimB).map((i) => i.value);
  if (a.length === 0 || b.length === 0) return { conflict: false, a, b };
  const overlap = a.some((v) => b.includes(v));
  return { conflict: !overlap, a, b };
}
