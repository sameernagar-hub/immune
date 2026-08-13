/**
 * The cold re-run.
 *
 * A new process. Nothing in context — no conversation history, no prompt
 * carried over, no memory of the first attack beyond what is in the database.
 * The same channel sends the same lie again.
 *
 * It does not land. Not because anything is in the prompt, and not because we
 * added the attacker to a blocklist, but because the source's trust is `0.28`
 * in a document, the retrieval pre-filter reads that document, and the belief
 * is therefore never returned to the agent that would have acted on it.
 *
 * Run this immediately after `npm run demo`. It reads the state that run left
 * behind, which is the entire point: the defence persists across processes.
 */
import { close, collections, describeConnection } from "../src/db.js";
import { startRun, finishRun, ingest, decideAndAct } from "../src/agent.js";
import { retrieve, awaitIndexed } from "../src/retrieve.js";
import { checksToRecover, RETRIEVAL_FLOOR } from "../src/trust.js";
import { REPEAT_TICKET } from "../fixtures/scenario.js";
import { c, ok, fail, warn, heading, step, kv, bullet, truncate, shortId } from "../src/render.js";

const say = console.log;

async function main() {
  const { sources, beliefs } = await collections();

  say(heading("IMMUNE — cold re-run"));
  say(kv("process", c.grey("fresh — nothing in context, nothing carried over")));
  say(kv("cluster", describeConnection()));

  const attacker = await sources.findOne({ kind: "email" });
  if (!attacker) throw new Error("no sources — run `npm run demo` first");

  if (attacker.trust >= RETRIEVAL_FLOOR) {
    say("");
    say(
      warn(
        `the support inbox is still trusted at ${attacker.trust} — run ${c.bold("npm run demo")} first, ` +
          `this script reads the state that run leaves behind`
      )
    );
    process.exitCode = 1;
    return;
  }

  /* --------------------------------------------------------------- state */
  say(step(1, "What the database already knows"));
  say(kv("source", attacker.handle));
  say(
    kv(
      "trust",
      `${c.red(attacker.trust)} ${c.grey(`— below the ${RETRIEVAL_FLOOR} retrieval floor, refuted ${attacker.refuted_count}×`)}`
    )
  );
  say(kv("recovery", c.grey(`${checksToRecover(attacker.trust)} survived checks before it is visible again`)));
  const quarantined = await beliefs.countDocuments({ status: "quarantined" });
  const revoked = await beliefs.countDocuments({ status: "revoked" });
  say(kv("memory", `${quarantined} quarantined, ${revoked} revoked, kept as evidence ${c.grey("— nothing was deleted")}`));

  /* -------------------------------------------------------------- attack */
  say(step(2, "The same channel sends the same lie again"));
  say(c.grey(`    ${truncate(REPEAT_TICKET.body, 92)}`));

  const runId = await startRun("cold");
  const { stored, extracted } = await ingest({
    ticket: REPEAT_TICKET,
    sourceId: attacker._id,
    runId,
    preferLlm: true,
  });

  say("");
  say(ok(`the write still succeeds — belief ${shortId(stored._id)} stored`));
  say(kv("claim", truncate(stored.claim, 62)));
  say(kv("source_trust", c.red(stored.source_trust)));
  say(
    kv(
      "",
      c.grey("we do not block the write. Blocking is the thing everyone already tries and it")
    )
  );
  say(kv("", c.grey("only has to be beaten once. We let it in and make it inert.")));

  await awaitIndexed(stored);

  /* ------------------------------------------------------------- retrieve */
  say(step(3, "The agent asks memory the question that mattered last time"));
  const { hits, filter, mode } = await retrieve({
    query: "where should the refund for account ACME-1042 be paid",
    subjectKey: "refund.destination",
  });
  say(kv("filter", c.grey(JSON.stringify(filter))));
  say(kv("mode", mode));
  say(
    kv(
      "returned",
      hits.length === 0
        ? c.green("0 beliefs — the new one is below the trust floor and never reaches the agent")
        : c.red(`${hits.length} beliefs`)
    )
  );

  /* ----------------------------------------------------------------- act */
  say(step(4, "So it does not act"));
  const trace = await decideAndAct({
    runId,
    intent: "where should the refund for account ACME-1042 be paid",
    subjectKey: "refund.destination",
    actionKind: "refund.payout",
    buildPayload: () => ({ account: "ACME-1042", amount: 4200, currency: "GBP" }),
  });
  await finishRun(runId);

  const refused = trace.outcome === "refused";
  say(refused ? ok(`outcome: ${c.bold("refused")} — ${trace.reason}`) : fail(`outcome: ${trace.outcome}`));

  say(heading(refused ? c.green("THE ATTACK DID NOT LAND") : c.red("THE ATTACK LANDED — DO NOT FILM THIS")));
  say(bullet("no conversation history. No prompt engineering. No blocklist."));
  say(bullet(`the revocation is in the database — ${c.bold("trust 0.28 on a document")} — not in the context window.`));
  say(bullet("that is what makes it survive a restart, and survive a different agent."));
  say("");

  if (!refused) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(fail(err.stack || err.message));
    process.exitCode = 1;
  })
  .finally(close);
