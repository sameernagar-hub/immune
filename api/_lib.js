/**
 * Shared plumbing for the hosted attack surface.
 *
 * The local `npm run live` server and these functions run the *same* agent code
 * out of `src/` — only the transport differs. Two things do have to change when
 * the surface is serverless, and both are honest degradations rather than
 * silent ones:
 *
 * 1. **No change streams.** A serverless invocation is too short-lived to hold
 *    an oplog cursor, so the hosted wall polls. That is rung 2 of the
 *    propagation ladder and the page says so in the corner. Change streams are
 *    still the real mechanism — `npm run watch` and `src/plugin.js` use them,
 *    and that is where the "one lie, N agents" proof lives.
 * 2. **No process-local state.** The operator token cannot live in a variable,
 *    because the next request may land on a different instance. So it is
 *    derived, not stored — see `windowToken`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";

/**
 * A QR that stops working.
 *
 * A static QR on a projector is a URL that anyone who photographed the screen
 * can hit for the rest of the evening, including after the demo has moved on.
 * So the code carries a token derived from the current time window:
 *
 *   token = HMAC(secret, floor(now / period))
 *
 * Nothing is stored anywhere, which is what makes it work on serverless — every
 * instance computes the same answer from the same clock. The previous window is
 * accepted too, so a code someone is mid-scan on does not die in their hands.
 * The projector page re-renders on the same period, so the wall always shows a
 * live one.
 */
export const ROTATE_SECONDS = Number(process.env.IMMUNE_QR_PERIOD || 90);

/**
 * How many past windows still validate.
 *
 * The projector re-renders on the rotation period, but a *phone* captures its
 * code once, at page load, and then a human has to read four options, pick one
 * and type a name. Accepting only the current and previous window meant a code
 * scanned 80 seconds into its window left the person about ten seconds — and
 * they got "that code has rotated" for doing nothing wrong. On stage, with the
 * phone being handed between people, that failure is close to guaranteed.
 *
 * So the wall still rotates every 90 s (the story and the countdown are
 * unchanged), but a code stays redeemable for GRACE_WINDOWS × period. The
 * tradeoff is deliberate: a photograph of the screen keeps working for a few
 * minutes rather than one, which is a far smaller problem than a volunteer
 * being rejected in front of judges.
 */
const GRACE_WINDOWS = Number(process.env.IMMUNE_QR_GRACE || 4);

const SECRET = process.env.IMMUNE_QR_SECRET || "immune-local-dev-secret";

export function windowToken(offset = 0, at = Date.now()) {
  const slot = Math.floor(at / (ROTATE_SECONDS * 1000)) + offset;
  return createHmac("sha256", SECRET).update(String(slot)).digest("hex").slice(0, 10);
}

/** Seconds until the current code rolls over — the page counts this down. */
export function secondsLeft(at = Date.now()) {
  const period = ROTATE_SECONDS * 1000;
  return Math.ceil((period - (at % period)) / 1000);
}

export function validToken(candidate) {
  if (!candidate) return false;
  const given = Buffer.from(String(candidate));
  // The current window plus GRACE_WINDOWS behind it. Constant-time compare
  // because the cost is nothing and a timing oracle on a token is a silly way
  // to lose.
  for (let offset = 0; offset >= -GRACE_WINDOWS; offset--) {
    const expected = Buffer.from(windowToken(offset));
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** How long a freshly-minted code stays redeemable, for copy and diagnostics. */
export function graceSeconds() {
  return ROTATE_SECONDS * GRACE_WINDOWS;
}

/** The operator token — separate from the audience token, and it does not rotate. */
export function isOperator(req) {
  const supplied = new URL(req.url, "http://x").searchParams.get("token");
  const expected = process.env.IMMUNE_OP_TOKEN || "";
  return Boolean(expected) && supplied === expected;
}

/**
 * Why `isOperator` said no — so a 403 is diagnosable in seconds.
 *
 * Failing closed when `IMMUNE_OP_TOKEN` is unset is correct: an unprotected
 * /api/respond is a stranger firing the immune response before the punchline.
 * But an unset variable and a wrong token are the same 403 from the outside,
 * and on a deploy where the variable was simply never added that is a very
 * expensive five minutes to spend on stage.
 */
export function operatorFailure(req) {
  if (!process.env.IMMUNE_OP_TOKEN) {
    return "IMMUNE_OP_TOKEN is not set on this deployment — add it in the Vercel project's environment variables and redeploy.";
  }
  const supplied = new URL(req.url, "http://x").searchParams.get("token");
  return supplied
    ? "operator token did not match"
    : "operator token required — append ?token=…";
}

/* ------------------------------------------------------------------ http */

export function json(res, code, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(code).send(JSON.stringify(body));
}

export async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 8000) data = data.slice(0, 8000);
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

export function oid(v) {
  if (!v || !ObjectId.isValid(String(v))) throw new Error("bad id");
  return new ObjectId(String(v));
}

/**
 * Wrap a handler so a thrown error becomes a JSON 400 rather than a stack trace
 * on a phone screen in front of an audience.
 */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (!res.headersSent) json(res, 400, { error: err.message });
    }
  };
}
