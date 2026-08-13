/**
 * The cold re-run, fired by the person who ran the original attack.
 *
 * The strongest twenty seconds in the demo, and it is stronger when the
 * attacker triggers it themselves from the same phone. The write succeeds. The
 * agent cannot see it. Nothing about that is in a context window — the source
 * sits below the retrieval floor, in the database.
 */
import { retry } from "../src/live-agent.js";
import { handler, json, body, oid } from "./_lib.js";

export const config = { maxDuration: 60 };

export default handler(async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const { sourceId, payloadId, freeText } = await body(req);
  const result = await retry({ sourceId: oid(sourceId), payloadId, freeText });
  json(res, 200, { ...result, belief: { ...result.belief, _id: String(result.belief._id) } });
});
