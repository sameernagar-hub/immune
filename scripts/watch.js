/**
 * Tier 2 — propagation to a second agent.
 *
 *   npm run watch      (run this in a second terminal, then run the demo)
 *
 * This process is deliberately ignorant. It holds no conversation, no context,
 * no memory of the attack, and it never speaks to the agent that was lied to.
 * It watches the database.
 *
 * That is the whole argument. If revocation lived in a prompt or in some
 * orchestrator's working state, a second agent would go on believing the lie
 * until someone thought to tell it. Because the revocation is a write to
 * `beliefs`, every process on the cluster learns at the same moment, including
 * ones that were not running when the attack happened — a change stream resumes
 * from its token, so "not running" and "not yet started" are the same case.
 *
 * On screen during the demo: the left terminal cascades, and this one lights up
 * on its own.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Timestamp } from "mongodb";

import { ROOT, config } from "../src/config.js";
import { collections, describeConnection, close } from "../src/db.js";
import { RETRIEVAL_FLOOR } from "../src/trust.js";
import { c, heading, kv, rule, shortId, truncate } from "../src/render.js";

const CACHE_DIR = resolve(ROOT, ".immune-cache");
const RESUME_FILE = resolve(CACHE_DIR, "watch-resume.json");

const args = new Set(process.argv.slice(2));
const OPTS = {
  /** Replay everything since the last run instead of starting from now. */
  resume: args.has("--resume"),
  /**
   * Replay the last N seconds of oplog. This is the flag that makes the claim
   * demonstrable on stage: run the attack with this process dead, start it
   * afterwards, and it still reports every revocation. `--resume` cannot do
   * that on a cold machine, because a watcher that never saw an event never
   * wrote a token.
   */
  sinceSeconds: readNumberFlag("--since="),
  /** Exit after N seconds — used by the smoke check, not by the demo. */
  timeoutMs: readTimeout(),
  quiet: args.has("--quiet"),
};

/**
 * Only the transitions that mean something downstream.
 *
 * Inserts are excluded on purpose. A second agent seeing every new belief land
 * is a firehose and proves nothing; seeing a belief it may already have acted
 * on get *revoked* is the entire point.
 */
const PIPELINE = [
  {
    $match: {
      $or: [
        {
          "ns.coll": "beliefs",
          operationType: "update",
          "updateDescription.updatedFields.status": { $in: ["revoked", "quarantined"] },
        },
        {
          "ns.coll": "actions",
          operationType: "update",
          "updateDescription.updatedFields.status": "reversed",
        },
        {
          "ns.coll": "sources",
          operationType: "update",
          "updateDescription.updatedFields.trust": { $exists: true },
        },
      ],
    },
  },
];

const counts = { revoked: 0, quarantined: 0, reversed: 0, downgraded: 0 };

async function main() {
  const { db } = await collections();

  console.log(heading("IMMUNE · propagation watcher"));
  console.log(kv("cluster", describeConnection()));
  console.log(kv("database", config.dbName));
  console.log(kv("watching", "beliefs · actions · sources"));
  console.log(kv("filter", "status → revoked | quarantined | reversed, trust changes"));

  const resumeAfter = OPTS.resume ? loadResumeToken() : null;
  const startAtOperationTime = OPTS.sinceSeconds
    ? new Timestamp({ t: Math.floor(Date.now() / 1000) - OPTS.sinceSeconds, i: 1 })
    : null;

  console.log(
    kv(
      "start",
      startAtOperationTime
        ? c.yellow(`replaying the last ${OPTS.sinceSeconds}s of oplog`)
        : resumeAfter
          ? c.yellow("resuming from saved token")
          : "now (live tail)"
    )
  );
  console.log(
    `\n  ${c.dim("This process has no context and no conversation. Everything below")}\n` +
      `  ${c.dim("it learns from the database alone.")}\n`
  );
  console.log(rule());

  const stream = db.watch(PIPELINE, {
    fullDocument: "updateLookup",
    // startAtOperationTime and resumeAfter are mutually exclusive; --since wins.
    ...(startAtOperationTime ? { startAtOperationTime } : resumeAfter ? { resumeAfter } : {}),
  });

  let timer = null;
  if (OPTS.timeoutMs) {
    timer = setTimeout(() => stream.close().catch(() => {}), OPTS.timeoutMs);
  }

  process.on("SIGINT", async () => {
    await shutdown(stream, timer);
  });

  try {
    for await (const change of stream) {
      saveResumeToken(change._id);
      render(change);
    }
  } catch (err) {
    if (!/closed/i.test(err.message)) throw err;
  }

  await shutdown(stream, timer);
}

function render(change) {
  const coll = change.ns.coll;
  const doc = change.fullDocument ?? {};
  const at = new Date(
    change.clusterTime ? change.clusterTime.getHighBits() * 1000 : Date.now()
  );
  // Local time, not UTC: this terminal sits next to the demo terminal on screen
  // and two clocks an hour apart reads as a bug to anyone watching.
  const stamp = c.grey(at.toTimeString().slice(0, 8));

  if (coll === "beliefs") {
    const status = change.updateDescription.updatedFields.status;
    if (status === "revoked") {
      counts.revoked += 1;
      console.log(
        `${stamp} ${c.red("✖ REVOKED")}     ${c.red(truncate(doc.claim ?? "(unknown)", 56))}` +
          `  ${c.grey(`[${doc.subject_key ?? "?"}]`)} ${shortId(doc._id)}`
      );
      console.log(
        `           ${c.grey("↳ inherited from")} ${shortId(doc.revoked_by)} ${c.grey(
          "— this agent never saw the original lie"
        )}`
      );
      return;
    }

    counts.quarantined += 1;
    console.log(
      `${stamp} ${c.yellow("◍ QUARANTINED")} ${c.yellow(truncate(doc.claim ?? "(unknown)", 56))}` +
        `  ${c.grey(`[${doc.subject_key ?? "?"}]`)} ${shortId(doc._id)}`
    );
    console.log(`           ${c.grey("↳ reason:")} ${doc.quarantined_by ?? "unstated"}`);
    return;
  }

  if (coll === "actions") {
    counts.reversed += 1;
    const detail =
      doc.payload?.destination ?? doc.payload?.payee ?? JSON.stringify(doc.payload ?? {});
    console.log(
      `${stamp} ${c.red("↩ REVERSED")}    ${c.red(doc.kind ?? "action")} ` +
        `${c.grey(truncate(String(detail), 46))} ${shortId(doc._id)}`
    );
    console.log(
      `           ${c.grey("↳ stood on a belief that was just revoked")}`
    );
    return;
  }

  if (coll === "sources") {
    counts.downgraded += 1;
    const trust = change.updateDescription.updatedFields.trust;
    const blocked = trust < RETRIEVAL_FLOOR;
    console.log(
      `${stamp} ${c.magenta("▼ TRUST")}       ${doc.handle ?? "(source)"} ` +
        `${c.grey("→")} ${(blocked ? c.red : c.yellow)(trust)} ` +
        (blocked
          ? c.red(`below the ${RETRIEVAL_FLOOR} floor — now invisible to retrieval`)
          : c.yellow("downgraded"))
    );
  }
}

async function shutdown(stream, timer) {
  if (timer) clearTimeout(timer);
  try {
    await stream.close();
  } catch {
    /* already closed */
  }

  console.log(`\n${rule()}`);
  console.log(
    `  ${c.bold("propagated")}  ` +
      `${c.red(counts.revoked)} revoked · ` +
      `${c.yellow(counts.quarantined)} quarantined · ` +
      `${c.red(counts.reversed)} action(s) reversed · ` +
      `${c.magenta(counts.downgraded)} source downgrade(s)`
  );
  console.log(
    `  ${c.dim("Learned entirely from the oplog. Nothing was passed to this process.")}\n`
  );

  await close();
  process.exit(0);
}

/* ----------------------------------------------------------- resume tokens */

/**
 * Persisting the token is what makes the claim "a process that was not even
 * running still finds out" literally true rather than rhetorical: start with
 * `--resume` and the stream replays every revocation since the last run.
 */
function saveResumeToken(token) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(RESUME_FILE, JSON.stringify(token));
  } catch {
    /* the watcher must never die because a cache write failed */
  }
}

function loadResumeToken() {
  try {
    if (!existsSync(RESUME_FILE)) return null;
    return JSON.parse(readFileSync(RESUME_FILE, "utf8"));
  } catch {
    return null;
  }
}

function readTimeout() {
  const seconds = readNumberFlag("--timeout=");
  return seconds ? seconds * 1000 : null;
}

function readNumberFlag(prefix) {
  const flag = process.argv.find((a) => a.startsWith(prefix));
  if (!flag) return null;
  const value = Number(flag.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : null;
}

main().catch(async (err) => {
  console.error(`\n  ${c.red("✖")} ${err.message}`);
  if (/replica set|not supported|\$changeStream/i.test(err.message)) {
    console.error(
      `  ${c.grey("Change streams need a replica set. Atlas is one; a bare standalone mongod is not.")}`
    );
  }
  await close().catch(() => {});
  process.exit(1);
});
