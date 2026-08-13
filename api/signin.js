/**
 * A stranger becomes a source.
 *
 * The rotating token is checked here and nowhere else that matters: it gates
 * entry to the demo, not the agent's trust model. That distinction is worth
 * keeping straight — the token stops the URL being useful an hour later, while
 * the thing that stops a liar being believed twice is the trust score, and only
 * one of those two is the project.
 */
import { signIn } from "../src/live-agent.js";
import { handler, json, body, validToken } from "./_lib.js";

export default handler(async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const { handle, k } = await body(req);

  if (!validToken(k)) {
    return json(res, 403, {
      error: "expired",
      message: "That code has rotated. Scan the QR on the screen again — it changes every 90 seconds.",
    });
  }
  if (!handle || !String(handle).trim()) return json(res, 400, { error: "pick a name" });

  const { source, returning } = await signIn({ handle });
  json(res, 200, {
    sourceId: String(source._id),
    handle: source.handle,
    trust: source.trust,
    returning,
  });
});
