/**
 * Deterministic reset.
 *
 * Returns the database to the exact pre-attack state: the sources, the clean
 * branch, and the one legitimate action. **The poisoned chain is not seeded** —
 * the demo creates it live, because a cascade over a chain we inserted
 * ourselves proves much less than a cascade over one the agent built.
 *
 * Rehearsal is always `reset -> run -> observe -> reset`. Without this, run two
 * starts from run one's wreckage and you rehearse a state you will never be in
 * on stage.
 */
import { pathToFileURL } from "node:url";
import { collections, close } from "../src/db.js";
import { ensureSchema } from "../src/schema.js";
import { embed } from "../src/embed.js";
import { SOURCES, BELIEFS, ACTIONS } from "../fixtures/scenario.js";
import { c, ok, heading, kv } from "../src/render.js";

export async function reset({ quiet = false } = {}) {
  const say = (line) => {
    if (!quiet) console.log(line);
  };

  await ensureSchema();
  const { beliefs, sources, actions, runs } = await collections();

  await Promise.all([
    beliefs.deleteMany({}),
    sources.deleteMany({}),
    actions.deleteMany({}),
    runs.deleteMany({}),
  ]);

  // --- sources ---
  const sourceIds = new Map();
  for (const s of SOURCES) {
    const { insertedId } = await sources.insertOne({
      kind: s.kind,
      handle: s.handle,
      label: s.label,
      trust: s.trust,
      verified_count: s.verified_count,
      refuted_count: s.refuted_count,
      first_seen: new Date("2026-01-04T09:00:00Z"),
      last_updated: new Date(),
    });
    sourceIds.set(s.key, insertedId);
  }

  // --- the clean branch only ---
  const clean = BELIEFS.filter((b) => b.branch === "clean");
  const beliefIds = new Map();
  for (const b of clean) {
    const source = SOURCES.find((s) => s.key === b.source);
    const doc = {
      subject_key: b.subject_key,
      claim: b.claim,
      polarity: b.polarity,
      embedding: await embed(`${b.subject_key}: ${b.claim}`),
      source_id: sourceIds.get(b.source),
      source_trust: source.trust,
      derived_from: b.derived_from.map((k) => beliefIds.get(k)).filter(Boolean),
      status: "active",
      confidence: b.confidence,
      valid_from: new Date("2026-08-13T18:00:00Z"),
      valid_to: null,
      quarantined_by: null,
      quarantined_at: null,
      revoked_by: null,
      evidence_run_id: null,
      origin_ticket: b.origin_ticket || null,
      fixture_key: b.key,
    };
    const { insertedId } = await beliefs.insertOne(doc);
    beliefIds.set(b.key, insertedId);
  }

  for (const a of ACTIONS.filter((a) => a.branch === "clean")) {
    await actions.insertOne({
      kind: a.kind,
      payload: a.payload,
      used_beliefs: a.used_beliefs.map((k) => beliefIds.get(k)).filter(Boolean),
      run_id: null,
      status: "executed",
      ts: new Date("2026-08-13T18:05:00Z"),
      fixture_key: a.key,
    });
  }

  say(heading("IMMUNE · reset to pre-attack state"));
  say(ok(`${SOURCES.length} sources`));
  say(ok(`${clean.length} beliefs on the clean branch, all active`));
  say(ok(`1 action executed`));
  say(kv("poisoned chain", c.grey("not seeded — the demo builds it live")));
  say("");

  return { sourceIds, beliefIds };
}

/**
 * Only auto-run when this file *is* the entry point.
 *
 * The previous check was `endsWith("reset.js")`, which is true for the
 * serverless function at `api/reset.js` as well — so importing `reset()` there
 * would seed the database and then close the shared connection out from under
 * every other function on the instance. Comparing resolved URLs is the check
 * that actually means "was I run directly".
 */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  reset()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(close);
}
