# Build log — 13 August 2026

What landed, when, and which fallback rungs we took. Written as we went, which
is why it reads like a log and not like a retrospective.

The hackathon rules require that a demo highlight only what the team built
during the event. This file, the commit history and the tags are that evidence.
**The repository was empty at 1:30 PM PT.**

---

## 1:38 PM — first commit, `COORDINATION.md`

Wrote the three-lane build contract before any code: exclusive file ownership
per lane so three people don't merge-conflict, the interfaces between lanes
frozen at 2:20, phase gates with binary conditions, and a fallback ladder for
each phase. Pushed first so the other two lanes were unblocked immediately.

Deliberately started a **fresh git history** rather than re-pointing the
pre-event planning repository at this remote. The planning repo's history
predates the build window; pushing it here would have put pre-window timestamps
on the public submission repo.

## 1:47–2:00 PM — P0: connection, schema, indexes

`src/config.js`, `src/db.js`, `src/schema.js`, `src/embed.js`, `src/trust.js`,
`scripts/doctor.js`.

**Fallback rung taken immediately: `mongodb+srv://` does not resolve on this
network.** It fails with a refused SRV lookup while ordinary name resolution is
fine. `src/db.js` walks a list of connection candidates and the direct form —
same cluster, addressed by shard host with an explicit `replicaSet` — connects.
This is an environment fault, so the fix is a second connection string rather
than a resolver override in application code.

Two ordering bugs, both found by `doctor`:

- the vector index was being created before the collection existed
- the `$graphLookup` probe used `$documents`, which only runs on a database-level
  aggregate, not a collection-level one

**Gate met.** `doctor` all green; vector index `READY` after **41 seconds**,
which is why the runbook says create it first and do other work while it builds.
Tagged `p0-green`.

## 2:00–2:45 PM — P1/P2: fixtures, provenance, retrieval, contradiction

`fixtures/scenario.js` and `fixtures/poison-ticket.md` first — the attack is the
thing everything else is plumbing around. Then `src/beliefs.js`,
`src/retrieve.js`, `src/indicators.js`, `src/contradict.js`, `src/verify.js`.

Decision worth recording: **`source_trust` is denormalised onto every belief.**
`$vectorSearch` can only pre-filter on fields of the documents it is searching,
so the alternative is a semantic search followed by an application-side filter,
which spends `limit` on documents that were always going to be discarded. The
cost is one `updateMany` when a source's reputation changes.

Also recorded: embeddings never left the deterministic path. `src/embed.js`
tries a provider when a key is present and otherwise uses a hashed
lexical embedder. **We are demoing the deterministic rung**, and the run prints
which one it used.

## 2:45–3:00 PM — P3: the cascade

`src/cascade.js`, `src/agent.js`, `scripts/reset.js`, `scripts/demo.js`.

First full run: the cascade worked, the tree rendered, and **three of seven
assertions failed.** All three had the same root cause, which took longer to see
than it should have.

### The bug that mattered: Atlas Search index lag

A belief written a moment ago is durably in the collection but **not yet
visible to the vector index**. The agent derived the suppression belief, asked
memory whether it existed, was told no, and took a different branch — so the
payout never executed, so there was no action to reverse, and the poisoned
belief got cascaded twice, decaying the source from 0.7 → 0.28 → **0.112**.

Three visible symptoms, one cause, and none of them looked like an indexing
problem. `awaitIndexed()` in `src/retrieve.js` now blocks until a write is
visible to the index. It also handles the inverse — after a revocation it waits
until the belief is *absent* from the real retrieval filter, because otherwise
the "same query, different answer" frame shows the pre-cascade answer, which is
the most expensive possible place to be stale.

### Two smaller fixes

- **Polarity was read off the whole ticket.** The poison ticket contains "do
  not require a further destination check", so a whole-text negation scan
  flagged the belief negative, and the incoming true claim then reported as an
  *opposite-polarity* conflict rather than the literal-value disagreement it is.
  Same cascade, wrong reason on screen. Polarity is now read off the extracted
  claim.
- **A belief could be quarantined twice.** Guarded in `src/cascade.js`, because
  a second decay makes the trust figure irreproducible.

**Gate met.** `npm run demo`: 7/7 assertions green — 3 descendants revoked,
1 quarantined, 1 payout reversed, 3 clean beliefs still active, 1 clean action
untouched, source trust `0.7 → 0.28`, retrieval `1 → 0`. Tagged `p3-green`.

## 3:05 PM — coordination doc goes live

Added a live status section so the other two lanes could pick up work without
asking, including the two non-obvious facts above — index lag and polarity —
since both would have cost them the same time they cost us.

## 3:15–3:30 PM — Tier 2: the cold re-run

`scripts/cold.js`. A fresh process, nothing in context, the same channel sending
the same lie. The write succeeds; the belief is inert because its source sits at
`0.28` and the retrieval floor is `0.5`. The agent refuses to act.

This is the brief's own headline — "No Cold Start" — and it is the shortest,
strongest twenty seconds in the demo, because the defence is visibly a number on
a document rather than anything in a context window.

## 3:30–3:45 PM — `scripts/inspect.js`, README, this file

`inspect.js` replays the `runs` collection, which turned out to be the best
answer to *"what did you build today"* — it prints the agent's own decision
trace, step by step, read back out of the database.

---

## Fallback rungs taken, in full

| Layer | Planned | Actually used | Why |
| --- | --- | --- | --- |
| Connection | `mongodb+srv://` | **direct, non-SRV** | the network refuses SRV lookups |
| Embeddings | provider API | **deterministic lexical** | no key configured; determinism is worth more than semantics here, and the run says so |
| Extraction | LLM, temp 0 | **deterministic rules** | LLM path is written and falls back automatically; we demo the rung we're standing on |
| Retrieval | `$vectorSearch` + `filter` | **as planned** | filter fields declared correctly first time |
| Cascade | `$graphLookup` in a transaction | **as planned** | transaction committed |
| Agent loop | graph-shaped with checkpoints | **`runs` document as checkpoint** | every step writes an event before acting |

## Cut

Nothing from Tier 1. Change-stream propagation to a second agent and the
ElevenLabs narration were scoped to Lane B and gated behind the core being
rehearsed, per the cut list.

**Never cut, and not cut:** provenance edges, the `$graphLookup` cascade, and
the clean branch staying green.
