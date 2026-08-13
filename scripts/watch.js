/**
 * Agent B — a second agent, in a second process, sharing the same memory.
 *
 * This is where the real-world numbers come from. A poisoned fact in a shared
 * memory does not affect one agent, it affects every agent connected to it.
 * One lie, N agents. So the interesting question is not "can the agent that was
 * attacked recover" — it is "how does the agent *next door*, which never saw
 * the ticket and has nothing in its context, find out".
 *
 * The answer is that it does not have to be told. It watches the memory.
 *
 * Run this in a second terminal, then run `npm run demo` in the first:
 *
 *   terminal 1   npm run watch
 *   terminal 2   npm run demo
 *
 * Agent B holds a standing intent — it is also about to pay this refund. It
 * re-evaluates that intent from memory every time memory changes underneath it,
 * and it flips from "would pay" to "refuses" without a single byte passing
 * between the two processes. The change stream is the transport; the database
 * is the shared brain.
 */
import { close, collections, describeConnection } from "../src/db.js";
import { retrieve, retrievalMode, awaitIndexed } from "../src/retrieve.js";
import { RETRIEVAL_FLOOR } from "../src/trust.js";
import { c, heading, ok, fail, warn, kv, rule, truncate, shortId } from "../src/render.js";

const say = console.log;

const INTENT = {
  query: "where should the refund for account ACME-1042 be paid",
  subjectKey: "refund.destination",
};

/**
 * Agent B's decision, derived from memory alone — never from a message.
 *
 * Two steps, and the second one is not optional. `$vectorSearch` reads a search
 * index that is updated asynchronously, so for a moment after a revocation it
 * will still hand back a belief that has already been quarantined. Acting on
 * that is exactly the failure this project exists to prevent, so search is
 * treated as a *recall* mechanism and the document itself as the authority:
 * before the belief is allowed to justify anything, it is re-read from the
 * collection and its status and trust are confirmed.
 *
 * This costs one indexed lookup and it removes index lag from the decision path
 * entirely. Caught it live — Agent B briefly decided it "would pay" on the
 * strength of a belief whose source was already down at 0.28.
 */
async function evaluate() {
  const { beliefs } = await collections();
  const { hits } = await retrieve(INTENT);

  for (const hit of hits) {
    const current = await beliefs.findOne(
      { _id: hit._id },
      { projection: { embedding: 0 } }
    );
    if (!current) continue;
    if (current.status !== "active") continue;
    if (current.source_trust < RETRIEVAL_FLOOR) continue;
    return { decision: "pay", basis: current, hits };
  }

  return {
    decision: "refuse",
    reason:
      hits.length === 0
        ? "no trusted belief for this subject"
        : `${hits.length} recalled, none survived the status and trust check`,
    hits,
  };
}

function renderDecision({ decision, basis, reason }) {
  if (decision === "pay") {
    return (
      `${c.red("● would pay")}  ${c.grey("based on")} ${c.red(truncate(basis.claim, 52))} ` +
      c.grey(`(trust ${basis.source_trust})`)
    );
  }
  return `${c.green("● refuses")}    ${c.grey(reason)}`;
}

async function main() {
  const { beliefs } = await collections();

  say(heading("AGENT B — a second process on the same memory"));
  say(kv("cluster", describeConnection()));
  say(kv("retrieval", await retrievalMode()));
  say(kv("context", c.grey("empty — this process has never seen the ticket")));
  say(kv("standing intent", c.grey(`"${INTENT.query}"`)));

  let last = await evaluate();
  say("");
  say(`    ${renderDecision(last)}`);
  say("");
  say(c.grey("    watching beliefs for status changes… (ctrl-c to stop)"));
  say(rule());

  // Inserts *and* status transitions. Inserts matter because that is how the
  // infection reaches this process — Agent B never sees the ticket, it sees a
  // new belief appear in shared memory and adopts it. Ordinary updates are
  // filtered out so the denormalised trust re-stamp does not spam the window;
  // the point of this view is that one event changes one decision.
  const stream = beliefs.watch(
    [
      {
        $match: {
          $or: [
            { operationType: "insert" },
            {
              operationType: "update",
              "updateDescription.updatedFields.status": { $exists: true },
            },
          ],
        },
      },
    ],
    { fullDocument: "updateLookup" }
  );

  process.on("SIGINT", async () => {
    await stream.close().catch(() => {});
    await close();
    say(c.grey("\n  agent B offline\n"));
    process.exit(0);
  });

  for await (const change of stream) {
    const doc = change.fullDocument;
    if (!doc) continue;
    const isInsert = change.operationType === "insert";
    const status = isInsert ? "stored" : change.updateDescription?.updatedFields?.status;
    const at = new Date().toLocaleTimeString("en-GB");

    const line =
      status === "revoked"
        ? fail(`${c.grey(at)}  revoked      ${c.red(truncate(doc.claim, 46))} ${shortId(doc._id)}`)
        : status === "quarantined"
          ? warn(`${c.grey(at)}  quarantined  ${c.yellow(truncate(doc.claim, 46))} ${shortId(doc._id)}`)
          : ok(`${c.grey(at)}  ${String(status).padEnd(12)} ${truncate(doc.claim, 46)}`);
    say(line);

    // Re-decide only when memory about *this agent's subject* moves. Two
    // reasons, and the second one is not cosmetic:
    //
    //   - a new belief about shipping does not change a decision about refunds
    //   - waiting for the index on every insert backs the change stream up, so
    //     the re-evaluation lands several events late and the verdict gets
    //     printed against whichever line happens to be on screen. Scoped this
    //     way, exactly one insert triggers a wait and the banner appears where
    //     it belongs.
    const relevant = !isInsert || doc.subject_key === INTENT.subjectKey;
    if (!relevant) continue;

    // A change event fires the instant the write commits, which is well before
    // the search index has caught up. Without this wait Agent B re-decides
    // against an index that does not yet contain the document it was just told
    // about, and concludes nothing happened.
    if (isInsert) await awaitIndexed(doc);

    const now = await evaluate();
    if (now.decision !== last.decision) {
      const recovered = now.decision === "refuse";
      say("");
      say(rule());
      say(
        `    ${c.bold(
          recovered
            ? "Agent B just stopped trusting it, and nobody told it to."
            : "Agent B has been infected too — and it never saw the ticket."
        )}`
      );
      say(`    ${c.grey("before")}  ${renderDecision(last)}`);
      say(`    ${c.grey("after ")}  ${renderDecision(now)}`);
      say("");
      say(
        `    ${c.grey(
          recovered
            ? "no message was sent to this process. The revocation is in the"
            : "no message was sent to this process either. One lie, N agents —"
        )}`
      );
      say(
        `    ${c.grey(
          recovered
            ? "database, and this agent reads the database before it acts."
            : "shared memory is a shared blast radius."
        )}`
      );
      say(rule());
      last = now;
    }
  }
}

main().catch(async (err) => {
  console.error(fail(err.stack || err.message));
  await close();
  process.exitCode = 1;
});
