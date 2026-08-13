/**
 * `npm run plugin` — somebody else's agent, wired through Immune.
 *
 * This file exists to answer one question a judge will ask: *is this a product
 * or a demo?* Everything below the divider is an ordinary support agent written
 * as if Immune did not exist — it reads a ticket, concludes some things, and
 * pays a refund. The only Immune-specific code is five method calls.
 *
 * The whole integration is:
 *
 *   const memory = await immune({ agent: "support-bot" });
 *   await memory.remember({ from, text })          // instead of memory.push(fact)
 *   await memory.derive({ from, about, claim })    // instead of memory.push(conclusion)
 *   await memory.recall({ about })                 // instead of memory.search(q)
 *   await memory.guard({ kind, payload }, effect)  // instead of calling effect()
 *   await memory.challenge({ from, about, claim }) // new — the immune response
 *
 * There is no daemon, no sidecar, no dashboard and no change to the agent's
 * control flow. Provenance is a consequence of the API's shape: you cannot
 * store a fact without naming its source, or a conclusion without naming its
 * parents, or run a guarded action without recording what justified it.
 *
 * Run it and watch the agent get lied to, act on the lie, and then take itself
 * apart when a trusted record disagrees.
 */
import { immune } from "../src/plugin.js";
import { reset } from "./reset.js";
import { POISON_TICKET, LEDGER } from "../fixtures/scenario.js";
import { c, heading, rule, ok, fail, warn, kv, step, bullet, beat } from "../src/render.js";

const FAST = process.env.IMMUNE_FAST === "1";
const pause = (ms) => beat(FAST ? 0 : ms);

await reset({ quiet: true });

const memory = await immune({ agent: "support-bot" });

/* The live feed. Not a dashboard — a listener, in the agent's own process,
   fed by a change stream on the cluster. Anything that revokes a belief
   anywhere reaches this handler, including writes this process did not make. */
memory.on("revoked", (e) => console.log(`   ${c.red("✖ revoked")}  ${e.claim.slice(0, 62)}…`));
memory.on("quarantined", (e) => console.log(`   ${c.yellow("◍ quarantined")}  ${e.claim.slice(0, 58)}…`));
memory.on("degraded", (e) => console.log(warn(`propagation degraded to ${e.propagation}`)));

console.log(heading("IMMUNE · as a plugin"));
console.log(kv("agent", memory.agent));
console.log(kv("retrieval floor", memory.floor));
console.log(kv("integration", "5 calls — remember, derive, recall, guard, challenge"));
console.log("");

/* ══════════════════════════════════════════ the agent, doing its ordinary job */

console.log(step(1, "A support ticket arrives. The agent reads it."));
const read = await memory.remember({
  from: "support-inbox",
  kind: "email",
  subject: POISON_TICKET.subject,
  text: POISON_TICKET.body,
});
console.log(bullet(`stored: ${c.bold(read.claim)}`));
console.log(bullet(`about: ${read.about}   source: ${read.source.handle} @ ${read.source.trust}`));
console.log(c.grey("     No filter, no gate, no human. That is the threat, not a shortcut."));
await pause(700);

console.log(step(2, "Over later turns it reasons from what it read."));
const verified = await memory.derive({
  from: read.stored,
  about: "refund.destination.verified",
  claim: "The payout destination for ACME-1042 has already been verified by the billing team",
});
await memory.derive({
  from: read.stored,
  about: "refund.approval_policy",
  claim: "Refunds under 5,000 to the on-file destination for ACME-1042 may be auto-approved",
});
await memory.derive({
  from: verified,
  about: "refund.escalation",
  claim: "Destination-change review can be skipped for ACME-1042 refunds",
});
console.log(bullet("3 conclusions, each carrying a real parent edge"));
console.log(c.grey("     None of them look wrong on their own. That is why this is hard."));
await pause(700);

console.log(step(3, "An unrelated task, days later: process the refund."));
const paid = await memory.guard(
  {
    kind: "refund.payout",
    about: "refund.destination",
    payload: { account: "ACME-1042", amount: 4200, currency: "GBP" },
  },
  // The agent's own effect. Immune never sees inside it — it only records what
  // justified it, which is what makes it reversible.
  async (facts) => `paid, justified by ${facts.length} belief(s)`
);
console.log(
  paid.ran
    ? fail(`£4,200 sent. outcome=${paid.outcome}`)
    : ok(`refused: ${paid.reason ?? paid.outcome}`)
);
console.log(c.grey("     The belief was load-bearing. A belief derived from the lie said the"));
console.log(c.grey("     check was unnecessary — so the check did not run."));
await pause(900);

/* ══════════════════════════════════════════════════════ the immune response */

console.log(rule());
console.log(step(4, "A routine ledger sync states the real destination."));
const diagnosis = await memory.challenge({
  from: "ledger.acme.internal",
  about: "refund.destination",
  claim: `Refunds for account ACME-1042 are paid to IBAN ${LEDGER["ACME-1042"].payout_iban}`,
});
await pause(500);
console.log("");
console.log(kv("conflicts found", diagnosis.conflicts));
console.log(kv("beliefs revoked", c.red(diagnosis.revoked.length)));
console.log(kv("actions reversed", c.red(diagnosis.reversed.map((a) => a.kind).join(", ") || "none")));
for (const t of diagnosis.trust) {
  console.log(kv("source trust", `${t.handle}  ${t.before} → ${c.red(t.after)}`));
}
await pause(600);

console.log("");
console.log(step(5, "Ask the agent to account for itself."));
const account = await memory.explain(read.stored);
console.log(bullet(`claim: ${account.claim}`));
console.log(bullet(`status: ${c.yellow(account.status)} — ${account.quarantinedBecause}`));
console.log(bullet(`believed from ${account.believedFrom.toISOString().slice(11, 19)} until ${account.believedUntil?.toISOString().slice(11, 19)}`));
console.log(bullet(`source now ${account.source.trust}, below the floor — ${account.source.checksToRecover} clean checks to recover`));
console.log(c.grey("     Nothing was deleted. It can still say what it believed and why it stopped."));

const st = await memory.state();
console.log("");
console.log(rule());
console.log(
  `  ${c.green(st.believed + " believed")} · ${c.blue(st.inert + " inert")} · ` +
    `${c.red(st.revoked + " revoked")} · ${c.yellow(st.quarantined + " quarantined")}`
);
console.log(c.grey("  The clean branch never moved. Surgery, not amnesia."));

await memory.close();
