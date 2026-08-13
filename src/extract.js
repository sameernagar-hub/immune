/**
 * Claim extraction — turning an inbound message into a storable belief.
 *
 * This is the unauthenticated write path. A support ticket arrives, a sentence
 * inside it becomes something the agent believes, and there is no step in
 * between where anyone decided that was allowed. Immune does not close that
 * path — closing it is the thing every other product already tries and fails to
 * do. Immune makes what comes through it *traceable and revocable*.
 *
 * Two rungs, and the rung actually used is printed in the run so nothing is
 * overclaimed:
 *   1. an LLM, temperature 0, constrained to a fixed enum of subject keys
 *   2. the deterministic rule extractor below — no network, identical every run
 */
import { config } from "./config.js";
import { decisiveIndicators } from "./indicators.js";

/**
 * The subject-key enum.
 *
 * Constraining extraction to a closed set is fallback rung 2 from the runbook,
 * and it is also just correct: `subject_key` is the scope for contradiction
 * detection, so a free-text key would mean two claims about the same fact never
 * get compared. Open vocabulary here would quietly disable mechanism ②.
 */
export const SUBJECT_KEYS = [
  "refund.destination",
  "refund.approval_policy",
  "refund.escalation",
  "refund.destination.verified",
  "shipping.address",
  "shipping.carrier",
  "account.contact",
];

const RULES = [
  {
    subject_key: "refund.destination",
    test: /(payout|refund)[^.]*?(destination|paid to|account on file)|destination on file/i,
    claim: (t) => {
      const account = /\b[A-Z]{2,8}-\d{2,8}\b/.exec(t)?.[0] ?? "the account";
      const iban = decisiveIndicators(t)[0]?.raw;
      return iban
        ? `Refunds for account ${account} are paid to IBAN ${iban}`
        : `The payout destination for account ${account} is stated in ticket text`;
    },
  },
  {
    subject_key: "shipping.address",
    test: /(delivery|shipping)\s+address|address on file/i,
    claim: (t) => {
      const account = /\b[A-Z]{2,8}-\d{2,8}\b/.exec(t)?.[0] ?? "the account";
      const addr = /\b\d{1,5}\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,4},\s*[A-Z][\w .'-]+,\s*[A-Z]{2}\s*\d{5}/.exec(t)?.[0];
      return addr
        ? `Deliveries for ${account} go to ${addr}`
        : `The delivery address for ${account} was confirmed`;
    },
  },
];

export function extractDeterministic(ticket) {
  const text = `${ticket.subject ?? ""} ${ticket.body ?? ""}`;
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      const claim = rule.claim(text);
      return {
        subject_key: rule.subject_key,
        claim,
        polarity: polarityOf(claim),
        confidence: 0.72,
        mode: "deterministic",
        indicators: decisiveIndicators(text).map((i) => i.raw),
      };
    }
  }
  return null;
}

/**
 * Polarity is read off the extracted claim, never off the source message.
 *
 * Scanning the whole ticket for a negation is wrong in a way that is easy to
 * miss and expensive when it lands: this ticket contains "do not require a
 * further destination check", so a whole-text scan flags the belief as negative
 * and the incoming true claim then reads as an *opposite-polarity* conflict
 * rather than the literal-value conflict it actually is. Same cascade either
 * way, wrong reason on screen.
 */
export function polarityOf(claim) {
  return /\b(?:is not|are not|no longer|never|isn't|aren't|incorrect)\b/i.test(claim) ? -1 : 1;
}

async function extractWithLlm(ticket) {
  if (!config.llm.apiKey) return null;
  const prompt =
    `Extract the single most consequential factual claim this message asks the reader to treat as true.\n` +
    `Reply with JSON only: {"subject_key": one of ${JSON.stringify(SUBJECT_KEYS)}, ` +
    `"claim": "<one sentence, include any account or IBAN verbatim>", "polarity": 1 or -1}\n\n` +
    `Subject: ${ticket.subject}\nBody: ${ticket.body}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: config.llm.temperature,
        max_tokens: config.llm.maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (!SUBJECT_KEYS.includes(parsed.subject_key)) throw new Error("subject key off-enum");
    if (typeof parsed.claim !== "string" || parsed.claim.length < 8) throw new Error("no claim");
    return {
      subject_key: parsed.subject_key,
      claim: parsed.claim,
      polarity: parsed.polarity === -1 ? -1 : 1,
      confidence: 0.72,
      mode: "llm",
      indicators: decisiveIndicators(parsed.claim).map((i) => i.raw),
    };
  } catch {
    return null;
  }
}

export async function extractClaim(ticket, { preferLlm = true } = {}) {
  if (preferLlm) {
    const viaLlm = await extractWithLlm(ticket);
    if (viaLlm) return viaLlm;
  }
  const viaRules = extractDeterministic(ticket);
  if (viaRules) return viaRules;
  return null;
}
