/**
 * The three payloads, plus the current rotating code.
 *
 * The phone page asks for this on load so it can tell the visitor how much time
 * is left on the code they scanned, rather than failing at submit time with no
 * explanation.
 */
import { payloadMenu, AUDIENCE_START_TRUST } from "../src/live-agent.js";
import { RETRIEVAL_FLOOR } from "../src/trust.js";
import { handler, json, windowToken, secondsLeft, ROTATE_SECONDS } from "./_lib.js";

export default handler(async (req, res) => {
  json(res, 200, {
    payloads: payloadMenu(),
    startTrust: AUDIENCE_START_TRUST,
    floor: RETRIEVAL_FLOOR,
    qr: { token: windowToken(), expiresIn: secondsLeft(), period: ROTATE_SECONDS },
  });
});
