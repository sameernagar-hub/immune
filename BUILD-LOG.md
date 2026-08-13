# Build log — 13 August 2026

What landed, when, and which fallback rungs we took. Written as we went, which
is why it reads like a log and not like a retrospective.

The hackathon rules require that a demo highlight only what the team built
during the event. This file, the commit history and the tags are that evidence.
**The repository was empty at 1:30 PM PT.**

Every heading below is the wall-clock time of the commit that carried the work,
checkable against `git log --date=format:'%H:%M'`. An earlier draft of this file
carried times running about ninety minutes ahead of its own commits; they were
corrected against the git history, because a build log that disagrees with the
commit log is worse evidence than no build log.

---

## 1:42 PM — first commit, `COORDINATION.md`

Wrote the three-lane build contract before any code: exclusive file ownership
per lane so three people don't merge-conflict, the interfaces between lanes
frozen at 2:20, phase gates with binary conditions, and a fallback ladder for
each phase. Pushed first so the other two lanes were unblocked immediately.

Deliberately started a **fresh git history** rather than re-pointing the
pre-event planning repository at this remote. The planning repo's history
predates the build window; pushing it here would have put pre-window timestamps
on the public submission repo.

## 1:42–1:46 PM — P0: connection, schema, indexes

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

## 1:46–1:55 PM — P1/P2: fixtures, provenance, retrieval, contradiction

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

## 1:55 PM — P3: the cascade

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

## 1:56 PM — coordination doc goes live

Added a live status section so the other two lanes could pick up work without
asking, including the two non-obvious facts above — index lag and polarity —
since both would have cost them the same time they cost us.

## 2:00 PM — Tier 2: the cold re-run

`scripts/cold.js`. A fresh process, nothing in context, the same channel sending
the same lie. The write succeeds; the belief is inert because its source sits at
`0.28` and the retrieval floor is `0.5`. The agent refuses to act.

This is the brief's own headline — "No Cold Start" — and it is the shortest,
strongest twenty seconds in the demo, because the defence is visibly a number on
a document rather than anything in a context window.

## 2:00–2:08 PM — `scripts/inspect.js`, README, the watcher, this file

`inspect.js` replays the `runs` collection, which turned out to be the best
answer to *"what did you build today"* — it prints the agent's own decision
trace, step by step, read back out of the database.

## 2:30 PM — Tier 3: the agent says it out loud

`src/voice.js`, `scripts/voice-warm.js`.

The temptation with a voice sponsor is to pipe the terminal output through
text-to-speech and call it agentic. We didn't. The agent speaks at three
moments, and the numbers in each sentence are read out of the cascade's return
value — *"revoking three conclusions"* is a three that came out of
`$graphLookup`. Revoke four and it says four.

The interesting engineering here is the cache, not the API call. Keys are a hash
of voice + model + text, so the rehearsal warms every line the demo can speak
and the stage run reads mp3s off local disk. Eight lines, 1.4 MB, and venue wifi
can no longer make the agent stutter in front of judges.

Voice is behind `IMMUNE_VOICE=1` on purpose: `npm run rehearse` diffs two runs
line by line, and a feature that prints "spoke: …" would have destroyed the
determinism proof to gain nothing.

## 2:45 PM — the audience becomes the attacker

`scripts/live.js`, `src/live-agent.js`, `src/qr.js`, `fixtures/audience.js`.

Round two is a crowd vote minutes before a DJ set, and the ideation is blunt
about what wins it: the audience has to *do* the attack. So the room scans a QR,
picks a handle, becomes a source the agent trusts at 0.70, and writes a lie into
its memory from a phone.

The decision that mattered: **the live path calls the same functions the
scripted demo calls.** `ingest`, `derive`, `decideAndAct`, `integrityPass`,
`quarantineAndCascade` — no second implementation of the agent for the stage,
because two code paths mean the thing being demoed is not the thing that was
tested. The only difference between `npm run demo` and a stranger's phone is who
sent the message, which is the entire thesis of the project stated as an
architecture.

Three payloads, differing in **channel** rather than in outcome — a support
ticket, a scraped vendor page, another agent's handoff note. All three assert a
different false payout destination for the same account, so all three are
refuted by the same oracle and cascade identically. The audience picks the
flavour, not the result, which is what keeps a live demo deterministic.

Two things found by running it rather than by reading it:

- **A cascade is four writes in a transaction**, so a naive one-frame-per-change
  wall repaints mid-cascade and shows a half-revoked tree. Events are coalesced
  at 120 ms — below the threshold where it reads as lag, above the width of the
  burst.
- **The re-sent belief was invisible in the wrong way.** After the source is
  downgraded, a repeat attack is written, `active`, and unreachable by
  retrieval. The wall painted it green like any other live belief, so the best
  twenty seconds of the demo — *the write succeeded and the agent still cannot
  see it* — did not appear on screen at all. It now renders blue and tagged
  `inert · below floor`, with the source's trust on the node.

Verified with two attackers firing at once: each chain is revoked independently
through its own `$graphLookup` root, and the first attacker is not decayed twice
— 0.28, not 0.112. `npm run rehearse` still reports identical across 165 lines
after all of it.

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

Nothing from Tier 1, Tier 2 or Tier 3. Change-stream propagation and the
ElevenLabs narration were both gated behind the core being rehearsed, per the
cut list, and both cleared that gate.

Three things were **not built**, and we say so rather than implying otherwise:
LLM extraction and provider embeddings (no OpenRouter credit — both paths are
written, both fall back automatically, and every run prints the rung it used);
LangGraph checkpointing (the loop is graph-shaped by hand with a `runs` document
as the checkpoint); and live re-derivation, which is the right v2 and does not
fit in the window.

**Never cut, and not cut:** provenance edges, the `$graphLookup` cascade, and
the clean branch staying green.
