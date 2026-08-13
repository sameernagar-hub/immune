/**
 * Pre-synthesise every line the demo can speak.
 *
 * Run this at the end of the rehearsal. It turns the stage run's dependency on
 * ElevenLabs from "must reach the API in real time in a loud warehouse on venue
 * wifi" into "must read an mp3 off local disk", which is the difference between
 * a Tier 3 feature that lands and one that hangs for four seconds in front of
 * judges.
 *
 * The numbers in the lines have to match what the cascade will actually return,
 * because the cache key is the exact text. That is why the expected values come
 * from the frozen scenario rather than being typed in here.
 */
import { warm, cacheStats, LINES, voiceConfig } from "../src/voice.js";
import { EXPECTED } from "../fixtures/scenario.js";
import { AUDIENCE_START_TRUST } from "../src/live-agent.js";
import { RETRIEVAL_FLOOR, decay } from "../src/trust.js";
import { AUDIENCE_PAYLOADS } from "../fixtures/audience.js";
import { c, heading, ok, fail, warn, kv } from "../src/render.js";

const handles = ["the support inbox", ...process.argv.slice(2)];

const lines = [];
for (const handle of handles) {
  lines.push(
    LINES.landed({ handle }),
    LINES.diagnosis({
      revoked: EXPECTED.revokedDescendants,
      reversed: EXPECTED.reversedActions,
      trustBefore: AUDIENCE_START_TRUST,
      trustAfter: decay(AUDIENCE_START_TRUST),
      handle,
    }),
    LINES.inert({ handle, trust: decay(AUDIENCE_START_TRUST), floor: RETRIEVAL_FLOOR })
  );
}
for (const p of AUDIENCE_PAYLOADS) {
  lines.push(LINES.acted({ amount: 4200, currency: "GBP", iban: p.iban }));
}
lines.push(LINES.clean({ count: EXPECTED.cleanBeliefsRemaining }));

console.log(heading("IMMUNE · warming the voice cache"));

if (!voiceConfig.apiKey) {
  console.log(fail("no ELEVENLABS_API_KEY in .env — the run will print these lines instead of speaking them"));
  for (const l of lines) console.log(c.grey(`  · ${l}`));
  process.exit(0);
}

console.log(kv("voice", voiceConfig.voiceId));
console.log(kv("model", voiceConfig.model));
console.log("");

const results = await warm(lines);
for (const r of results) {
  const head = r.text.slice(0, 66);
  if (r.rung === "failed") console.log(fail(`${head}… — ${r.error}`));
  else if (r.rung === "cached") console.log(c.grey(`  cached  ${head}…`));
  else console.log(ok(`synthesised  ${head}…`));
}

const failed = results.filter((r) => r.rung === "failed").length;
const stats = cacheStats();
console.log("");
console.log(kv("cache", `${stats.files} files · ${(stats.bytes / 1024).toFixed(0)} KB`));
if (failed) {
  console.log(warn(`${failed} line(s) did not synthesise — those fall back to printed text, which is rung 3 and fine`));
} else {
  console.log(ok("every line is on local disk — the stage run needs no network for voice"));
}
