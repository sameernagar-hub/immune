/**
 * The rotating QR, as an SVG.
 *
 * Regenerated per request rather than cached, because the whole point is that
 * the code in it stops working. `Cache-Control: no-store` is load-bearing here
 * — a CDN edge holding this for five minutes would hand out dead codes.
 */
import { qrSvg } from "../src/qr.js";
import { handler, windowToken, secondsLeft, ROTATE_SECONDS } from "./_lib.js";

export default handler(async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const target = `https://${req.headers.host}/?k=${windowToken()}`;
  const svg = await qrSvg(target, { width: Number(url.searchParams.get("w") || 420) });

  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!svg) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(JSON.stringify({ url: target, svg: null }));
  }
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("X-Immune-Expires-In", String(secondsLeft()));
  res.setHeader("X-Immune-Rotate-Period", String(ROTATE_SECONDS));
  res.status(200).send(svg);
});
