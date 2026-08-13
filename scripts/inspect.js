/**
 * Memory inspector.
 *
 * Prints the current state of memory without changing it: the provenance tree,
 * source reputations, and the action ledger. Useful mid-rehearsal to check what
 * state a run left behind, and useful on stage to answer "show me the data".
 *
 *   node scripts/inspect.js                    everything
 *   node scripts/inspect.js <belief-id>        the blast radius of one belief
 */
import { close, collections } from "../src/db.js";
import { ObjectId } from "mongodb";
import { traceContamination } from "../src/cascade.js";
import { checksToRecover, RETRIEVAL_FLOOR } from "../src/trust.js";
import {
  c, heading, kv, rule, renderTree, renderPipeline, statusMark, truncate, shortId, fail,
} from "../src/render.js";

const say = console.log;

async function main() {
  const { beliefs, sources, actions, runs } = await collections();
  const target = process.argv[2];

  if (target) {
    const id = new ObjectId(target);
    const { root, contaminated } = await traceContamination(id);
    if (!root) throw new Error(`no belief ${target}`);
    say(heading("BLAST RADIUS"));
    say(kv("belief", truncate(root.claim, 60)));
    say(kv("subject", c.cyan(root.subject_key)));
    say(kv("descendants", contaminated.length));
    say("");
    for (const d of contaminated) {
      say(`    ${statusMark(d.status)} ${c.grey(`depth ${d.distance + 1}`)}  ${truncate(d.claim, 54)}`);
    }
    say(heading("PIPELINE"));
    say(renderPipeline((await traceContamination(id), [null, { $graphLookup: pipelineOf(id) }])[1]));
    return;
  }

  const docs = await beliefs.find({}, { projection: { embedding: 0 } }).sort({ valid_from: 1 }).toArray();
  say(heading("BELIEFS"));
  say(renderTree(docs));
  say("");
  const counts = docs.reduce((acc, b) => ({ ...acc, [b.status]: (acc[b.status] || 0) + 1 }), {});
  say(kv("totals", Object.entries(counts).map(([k, v]) => `${k} ${v}`).join("  ")));

  say(heading("SOURCES"));
  for (const s of await sources.find({}).sort({ trust: -1 }).toArray()) {
    const visible = s.trust >= RETRIEVAL_FLOOR;
    say(
      `    ${visible ? c.green("●") : c.red("✖")} ${String(s.handle).padEnd(46)} ` +
        `${(visible ? c.green : c.red)(String(s.trust).padEnd(6))} ` +
        c.grey(`✔${s.verified_count} ✖${s.refuted_count}` + (visible ? "" : ` · ${checksToRecover(s.trust)} checks to recover`))
    );
  }

  say(heading("ACTIONS"));
  for (const a of await actions.find({}).sort({ ts: 1 }).toArray()) {
    say(
      `    ${statusMark(a.status)} ${String(a.kind).padEnd(20)} ` +
        `${(a.status === "reversed" ? c.red : c.green)(a.status.padEnd(9))} ` +
        c.grey(`${a.used_beliefs.length} belief(s)  ${JSON.stringify(a.payload).slice(0, 60)}`)
    );
  }

  say(heading("RUNS"));
  for (const r of await runs.find({}).sort({ started_at: 1 }).toArray()) {
    say(`    ${c.cyan(String(r.kind).padEnd(8))} ${shortId(r._id)} ${c.grey(`${r.events.length} events`)}`);
    for (const e of r.events) say(`        ${c.grey(String(e.step).padEnd(10))} ${c.grey(summarise(e))}`);
  }
  say("");
}

function pipelineOf(id) {
  return {
    from: "beliefs",
    startWith: "$_id",
    connectFromField: "_id",
    connectToField: "derived_from",
    as: "contaminated",
    maxDepth: 6,
    depthField: "distance",
  };
}

function summarise(event) {
  const { step, at, ...rest } = event;
  return Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ")
    .slice(0, 96);
}

main()
  .catch((err) => {
    console.error(fail(err.stack || err.message));
    process.exitCode = 1;
  })
  .finally(close);
