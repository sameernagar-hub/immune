/**
 * The wall's data source.
 *
 * Polled rather than streamed, because a serverless invocation cannot hold a
 * change-stream cursor open. The payload is small — embeddings are projected
 * out in `wallState()` — so a poll every second and a bit is cheaper than it
 * looks and indistinguishable from a stream at demo speed.
 */
import { wallState } from "../src/live-agent.js";
import { handler, json, windowToken, secondsLeft, ROTATE_SECONDS } from "./_lib.js";

export default handler(async (req, res) => {
  const state = await wallState();
  json(res, 200, {
    ...state,
    propagation: "poll",
    qr: { token: windowToken(), expiresIn: secondsLeft(), period: ROTATE_SECONDS },
  });
});
