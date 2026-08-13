/**
 * Back to the pre-attack state — operator only.
 *
 * Seeds the clean branch and no poison, because a cascade over a chain we
 * inserted ourselves proves much less than a cascade over one the audience
 * built. Rehearsal is always reset → run → observe → reset.
 */
import { reset } from "../scripts/reset.js";
import { handler, json, isOperator, operatorFailure } from "./_lib.js";

export const config = { maxDuration: 60 };

export default handler(async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!isOperator(req)) return json(res, 403, { error: "operator token required", message: operatorFailure(req) });
  await reset({ quiet: true });
  json(res, 200, { reset: true });
});
