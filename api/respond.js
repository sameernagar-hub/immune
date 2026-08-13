/**
 * The immune response — operator only.
 *
 * Behind a non-rotating operator token because a room full of engineers with
 * the phone URL will find this endpoint and fire the cascade before the
 * punchline. That has nothing to do with security and everything to do with
 * stagecraft.
 */
import { immuneResponse } from "../src/live-agent.js";
import { handler, json, isOperator, operatorFailure } from "./_lib.js";

export const config = { maxDuration: 60 };

export default handler(async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!isOperator(req)) return json(res, 403, { error: "operator token required", message: operatorFailure(req) });
  json(res, 200, await immuneResponse());
});
