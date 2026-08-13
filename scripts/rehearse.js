/**
 * The determinism check.
 *
 * Runs the full demo twice, back to back, and diffs the two transcripts with
 * ObjectIds masked. If run one and run two differ in any visible way, that
 * difference is the only thing worth fixing — everything else can wait.
 *
 * Round one of judging is decided off a sixty-second video. A run that behaves
 * differently on the take is worth nothing, and the failure mode is not a crash
 * — it is one branch quietly going the other way and nobody noticing until the
 * footage is reviewed.
 *
 *   npm run rehearse
 */
import { spawnSync } from "node:child_process";
import { c, heading, ok, fail, kv } from "../src/render.js";

const say = console.log;

function run(script) {
  const res = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, IMMUNE_FAST: "1", NO_COLOR: "1" },
  });
  return { out: `${res.stdout || ""}${res.stderr || ""}`, code: res.status };
}

/** ObjectIds change every run by design; nothing else may. */
function mask(text) {
  return text
    .replace(/[0-9a-f]{24}/g, "<id>")
    .replace(/\b[0-9a-f]{6}\b/g, "<sid>")
    .split(/\r?\n/);
}

function pass(label) {
  const a = run("scripts/demo.js");
  const b = run("scripts/cold.js");
  return { text: a.out + b.out, ok: a.code === 0 && b.code === 0, label };
}

const first = pass("run 1");
const second = pass("run 2");

const left = mask(first.text);
const right = mask(second.text);

const diffs = [];
for (let i = 0; i < Math.max(left.length, right.length); i++) {
  if (left[i] !== right[i]) diffs.push({ line: i + 1, a: left[i] ?? "", b: right[i] ?? "" });
}

say(heading("IMMUNE · rehearsal"));
say(kv("run 1", first.ok ? c.green("assertions passed") : c.red("assertions FAILED")));
say(kv("run 2", second.ok ? c.green("assertions passed") : c.red("assertions FAILED")));
say(kv("lines", `${left.length} vs ${right.length}`));
say("");

if (diffs.length === 0 && first.ok && second.ok) {
  say(ok(c.bold(`identical across ${left.length} lines — safe to film`)));
  say(c.grey("\n  reminder: audio test at 4:15, and listen back before the real take.\n"));
} else {
  say(fail(c.bold(`${diffs.length} differing line(s) — do not film until this is zero`)));
  for (const d of diffs.slice(0, 12)) {
    say(`  ${c.grey(String(d.line).padStart(4))}  ${c.red("- " + d.a)}`);
    say(`  ${c.grey("    ")}  ${c.green("+ " + d.b)}`);
  }
  if (diffs.length > 12) say(c.grey(`  …and ${diffs.length - 12} more`));
  say("");
  process.exitCode = 1;
}
