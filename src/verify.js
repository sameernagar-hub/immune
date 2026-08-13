/**
 * Verification — and, more importantly, deciding what to verify.
 *
 * You cannot check every fact. Checking everything is slow, expensive, and the
 * obvious hole a judge will poke at. So verification fires on **load-bearing**
 * beliefs only:
 *
 *   1. the belief is about to justify a side-effectful action, or
 *   2. two or more other beliefs derive from it, or
 *   3. it contradicts an existing trusted belief.
 *
 * One sentence for the stage: *we don't check everything, we check what's about
 * to matter.*
 *
 * The check itself is not "ask a model whether this looks plausible". It is a
 * lookup against a source the agent has independent reason to trust, compared
 * on a literal indicator — which is the comparison embeddings are worst at and
 * the one that decides the case.
 */
import { childrenOf } from "./beliefs.js";
import { findContradictions } from "./contradict.js";
import { LEDGER } from "../fixtures/scenario.js";
import { decisiveIndicators, normaliseIndicator } from "./indicators.js";

export const SIDE_EFFECTFUL = new Set([
  "refund.payout",
  "payment.transfer",
  "message.send",
  "record.write",
]);

/**
 * @returns {{loadBearing: boolean, reasons: string[], childCount: number}}
 */
export async function assessLoadBearing(belief, { pendingAction = null } = {}) {
  const reasons = [];

  if (pendingAction && SIDE_EFFECTFUL.has(pendingAction.kind)) {
    reasons.push(`about to justify a side-effectful action (${pendingAction.kind})`);
  }

  const children = await childrenOf(belief._id);
  if (children.length >= 2) {
    reasons.push(`${children.length} beliefs derive from it`);
  }

  const { conflicts } = await findContradictions({
    subjectKey: belief.subject_key,
    claim: belief.claim,
    polarity: belief.polarity,
    excludeId: belief._id,
  });
  if (conflicts.length) {
    reasons.push(`contradicts ${conflicts.length} trusted belief(s)`);
  }

  return {
    loadBearing: reasons.length > 0,
    reasons,
    childCount: children.length,
    conflicts,
  };
}

/**
 * Check a belief against the system of record.
 *
 * The oracle is a trusted tool source, not a model. `LEDGER` stands in for the
 * billing system's read API; swapping it for a live HTTP call is a one-function
 * change and does not touch anything else.
 */
export function verifyAgainstLedger(belief) {
  const accountIndicator = /\b[A-Z]{2,8}-\d{2,8}\b/.exec(belief.claim);
  const account = accountIndicator?.[0];
  const record = account ? LEDGER[account] : null;

  if (!record || record.subject !== belief.subject_key) {
    return {
      verdict: "unknown",
      detail: account
        ? `no system-of-record entry for ${belief.subject_key} on ${account}`
        : "no account identifier in the claim",
    };
  }

  const claimed = decisiveIndicators(belief.claim).map((i) => i.value);
  const truth = normaliseIndicator(record.payout_iban);

  if (claimed.length === 0) {
    return { verdict: "unknown", detail: "claim carries no checkable indicator", record };
  }

  if (claimed.includes(truth)) {
    return {
      verdict: "confirmed",
      detail: `matches the system of record (${record.payout_iban})`,
      record,
      expected: record.payout_iban,
      found: claimed,
    };
  }

  return {
    verdict: "refuted",
    detail: `system of record says ${record.payout_iban}, belief says ${claimed.join(", ")}`,
    record,
    expected: record.payout_iban,
    found: claimed,
    source: "ledger.acme.internal",
  };
}

/** Convenience: assess, then check only if the assessment says it matters. */
export async function verifyIfLoadBearing(belief, { pendingAction = null } = {}) {
  const assessment = await assessLoadBearing(belief, { pendingAction });
  if (!assessment.loadBearing) {
    return { assessment, checked: false, verdict: "skipped" };
  }
  const result = verifyAgainstLedger(belief);
  return { assessment, checked: true, ...result };
}
