/**
 * `npm run team:env` — hand a teammate a working `.env` without committing one.
 *
 * Lane B and Lane C need the same cluster, the same database and the same keys
 * as Lane A, and the fastest way to give it to them is a filled-in file. The
 * one thing we must not do is put that file in the repo: the repo is public,
 * and a public commit containing an Atlas password is not a mistake you undo by
 * deleting the file — the credential is burned the moment it is pushed.
 *
 * So this writes `team-env.txt` (gitignored) for you to send over a private
 * channel, and prints a masked version to the terminal so you can confirm the
 * right values are in it without shoulder-surfing being a problem.
 *
 *   npm run team:env            masked to the terminal, file written
 *   npm run team:env -- --show  full values to the terminal too
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../src/config.js";
import { c, heading, ok, fail, warn, kv, rule } from "../src/render.js";

const SHOW = process.argv.includes("--show");
const SECRET = /(PASSWORD|KEY|TOKEN|SECRET|URI)/i;

const envPath = resolve(ROOT, ".env");
const outPath = resolve(ROOT, "team-env.txt");

console.log(heading("IMMUNE · credentials for the other lanes"));

if (!existsSync(envPath)) {
  console.log(fail("no .env here — nothing to share. Copy .env.example and fill it in first."));
  process.exit(1);
}

const raw = readFileSync(envPath, "utf8");

/** Mask everything but the shape, so a screenshot of this is harmless. */
function mask(value) {
  const v = value.replace(/^["']|["']$/g, "");
  if (!v) return c.grey("(empty)");
  if (v.length <= 8) return `${v.slice(0, 2)}${"•".repeat(v.length - 2)}`;
  return `${v.slice(0, 6)}${"•".repeat(Math.min(18, v.length - 10))}${v.slice(-4)}  ${c.grey(`(${v.length} chars)`)}`;
}

let shown = 0;
for (const line of raw.split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
  if (!m) continue;
  const [, key, value] = m;
  shown++;
  const display = SHOW || !SECRET.test(key) ? value.replace(/^["']|["']$/g, "") || c.grey("(empty)") : mask(value);
  console.log(kv(key, display, 24));
}

writeFileSync(
  outPath,
  [
    "# IMMUNE — paste this into immune/.env on your machine.",
    "# Sent over a private channel on purpose. Do not commit it, do not paste it",
    "# into an issue, a PR, or a screen you are about to share.",
    "",
    raw.trimEnd(),
    "",
  ].join("\n"),
  "utf8"
);

console.log("");
console.log(ok(`${shown} variables written to ${c.bold("team-env.txt")} (gitignored)`));
console.log(rule());
console.log(warn("Send that file over a DM, not the shared channel. Never `git add` it."));
console.log(c.grey("  Rotate the Atlas password and the ElevenLabs key after the event."));
