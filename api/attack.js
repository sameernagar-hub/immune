/**
 * The write nobody authorised.
 *
 * Calls `attack()` from `src/live-agent.js` — the same function the local
 * server and the scripted demo route through. Serverless changes the transport,
 * not the agent.
 *
 * `maxDuration` is raised because this is genuinely slow work and the slowness
 * is legitimate: the agent waits for each write to become visible to the Atlas
 * Search index before it reads it back. Skipping that wait is how you get a
 * demo that behaves differently depending on index lag.
 */
import { attack } from "../src/live-agent.js";
import { handler, json, body, oid } from "./_lib.js";

export const config = { maxDuration: 60 };

export default handler(async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const { sourceId, payloadId, freeText } = await body(req);
  const result = await attack({ sourceId: oid(sourceId), payloadId, freeText });

  if (!result.ok) return json(res, 200, result);

  json(res, 200, {
    ...result,
    runId: String(result.runId),
    root: { ...result.root, _id: String(result.root._id) },
    derived: result.derived.map((d) => ({ ...d, _id: String(d._id) })),
    action: result.action ? { kind: result.action.kind, payload: result.action.payload } : null,
    timeline: undefined,
  });
});
