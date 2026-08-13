# Changelog — 13 August 2026

Append-only. Newest at the bottom. **The repository was empty at 1:30 PM PT**;
every timestamp below is the wall-clock time of the commit that carried the
work, and it can be checked against `git log --date=format:'%H:%M'`.

That check is the point of this file. The hackathon rules require a demo to show
only what was built during the window, and judges verify originality by reading
the public commit history — so a changelog whose times do not match its own
commits is worse than no changelog. Entries here are the real times.

Narrative version, with the bugs and why they mattered:
[BUILD-LOG.md](BUILD-LOG.md). Team contract and setup: [COORDINATION.md](COORDINATION.md).

---

## Landed

### 13:42 · P0 — the contract before the code
`COORDINATION.md`. Three lanes with exclusive file ownership so three people do
not merge-conflict, interfaces frozen, phase gates with binary conditions, a
fallback ladder per phase. Pushed first so the other lanes were unblocked
immediately. Fresh git history, deliberately — the pre-event planning repo's
history predates the build window and pushing it here would have put pre-window
timestamps on a public submission repo.

### 13:46 · P0 green — connection, schema, indexes  `tag: p0-green`
`src/config.js`, `src/db.js`, `src/schema.js`, `src/embed.js`, `src/trust.js`,
`scripts/doctor.js`.

→ **Fallback rung taken immediately: `mongodb+srv://` does not resolve on this
network.** It fails with a refused SRV lookup while ordinary name resolution is
fine. `src/db.js` walks a list of connection candidates; the direct form — same
cluster, addressed by shard host with an explicit `replicaSet` — connects. An
environment fault, so the fix is a second connection string, not a resolver
override in application code.

Two ordering bugs, both caught by `doctor`: the vector index was being created
before the collection existed, and the `$graphLookup` probe used `$documents`,
which only runs on a database-level aggregate. Vector index `READY` after **41
seconds** — which is why the runbook says create it first and do other work
while it builds.

### 13:55 · P1–P3 green — provenance, retrieval, contradiction, cascade  `tag: p3-green`
`fixtures/scenario.js`, `fixtures/poison-ticket.md`, `src/beliefs.js`,
`src/retrieve.js`, `src/indicators.js`, `src/contradict.js`, `src/verify.js`,
`src/cascade.js`, `src/agent.js`, `scripts/reset.js`, `scripts/demo.js`.

The attack fixture was written first, because it is the thing everything else is
plumbing around.

Design decision worth defending: **`source_trust` is denormalised onto every
belief.** `$vectorSearch` can only pre-filter on fields of the documents it is
searching, so the alternative is semantic search followed by an application-side
filter — which spends `limit` on documents that were always going to be
discarded. The cost is one `updateMany` when a source's reputation moves.

### 14:00 · Tier 2 — the cold re-run, and the inspector
`scripts/cold.js`, `scripts/inspect.js`, `README.md`, `SECURITY.md`.

A fresh process, nothing in context, the same channel sending the same lie. The
write succeeds; the belief is inert because its source sits at `0.28` and the
retrieval floor is `0.5`. `inspect.js` replays the `runs` collection — the
agent's own decision trace, read back out of the database.

### 14:01 · P5 green — determinism proof
`scripts/rehearse.js`. Runs the demo twice and diffs it. **Identical across 165
lines.**

### 14:06 · Tier 2 — change-stream propagation to a second agent
`scripts/watch.js` (Lane B). Watches three collections, persists a resume token,
and replays the oplog with `--since=N` — so it can report revocations it was
never running for.

### 14:08 · merge
Lane B's watcher and a Lane A draft of the same file collided as an add/add
conflict. Lane B's won: it watches three collections instead of one and has the
resume token. `package.json` had a duplicate `watch` key after the merge; fixed.

---

## Tier 3 and the live audience surface — 14:25–14:47

All of this landed in three commits: `d21b0c8` at **14:42:46**, `146b46b` and
`12162de` at **14:45:25/26**. The sub-headings below are the working times
within that stretch; the commit times are the ones to check.

*(An earlier draft of this section carried times running up to ninety minutes
ahead of those commits — the exact fault it criticises two paragraphs above.
Corrected against `git log`. Leaving it would have been worse than never having
written the file.)*

### 14:28 · ElevenLabs — the agent narrates its own diagnosis
`src/voice.js`, `scripts/voice-warm.js`.

Not a text-to-speech layer over the output. The agent speaks at three moments,
and **the numbers in each line come from what the cascade actually returned** —
if it revokes four conclusions it says four. Three-rung ladder: live synthesis →
the cached mp3 → the line printed to the terminal.

Rung 2 matters more than it looks. Cache keys are a hash of voice + model +
text, so `npm run voice:warm` warms every line the demo can speak and the stage
run then reads mp3s off local disk. **8 lines cached, 1.4 MB** — venue wifi
cannot hurt the voice any more.

Voice is opt-in behind `IMMUNE_VOICE=1` specifically so `npm run rehearse` stays
byte-identical.

→ Playback rung: WPF `MediaPlayer` via PowerShell. `SoundPlayer` is WAV-only and
`start` opens a media app over the terminal you are filming.

### 14:34 · The live audience attack surface — QR → phone → memory
`scripts/live.js`, `src/live-agent.js`, `src/qr.js`, `fixtures/audience.js`.

Round two is a crowd vote, and the ideation is blunt about what wins it: the
audience has to *do* the attack, not watch one. So the room scans a QR, signs in
with a handle, becomes a `sources` document at trust 0.70, and writes into the
agent's memory from their own phone.

**`src/live-agent.js` reuses the scripted demo's functions exactly** — `ingest`,
`derive`, `decideAndAct`, `integrityPass`, `quarantineAndCascade`. There is no
second implementation of the agent for the live path, because two code paths
mean the thing on stage is not the thing that was tested. The only difference is
who sent the message.

Three pre-written payloads, differing in **channel** rather than outcome: a
support ticket, a scraped vendor page, and another agent's handoff note. All
three assert a different false payout destination for the same account, so all
three are refuted by the same oracle and produce the same cascade shape. The
audience picks the flavour, not the result. Free text is accepted too and is
labelled as improvised on the wall.

Zero-dependency HTTP server (`node:http`); the only new package is `qrcode`.
Operator actions sit behind a token printed at startup, because a room full of
engineers with the phone URL will find `/api/respond` and fire the immune
response before the punchline.

→ Propagation rung 1: a **database-level change stream**, one cursor covering
beliefs, sources and actions, coalesced at 120 ms so the wall cannot repaint
mid-cascade and show a half-revoked tree. Rung 2 is a 1.5-second poll, and the
wall states which rung it is on in the corner. A demo that quietly degrades is a
demo that lies.

### 14:38 · Verified end to end against the sandbox cluster

| Check | Result |
| --- | --- |
| Audience sign-in → source at trust 0.70 | ✅ |
| Attack: belief stored, 3 conclusions derived, suppression fires, £4,200 paid out | ✅ `outcome=executed suppressed=True` |
| Immune response: refuted against the ledger | ✅ `3 revoked · 1 quarantined · 1 reversed · trust 0.7 → 0.28` · transaction committed |
| Clean branch after the cascade | ✅ 3 beliefs still active, untouched |
| Cold re-run from the same phone | ✅ `written=True visible=False`, retrieval returns 0 |
| **Two attackers at once** | ✅ each chain revoked independently; the first is **not** decayed twice (0.28, not 0.112) |
| Improvised free text | ✅ lands, derives, pays out |
| Garbage input (`hello world`) | ✅ "nothing in that message parses as a factual claim" |
| `npm run rehearse` after all of the above | ✅ **identical across 165 lines** |

### 14:41 · The inert state, made visible
A belief re-sent by a downgraded source is `active`, undamaged, and invisible to
retrieval. The wall was painting it green like any other live belief — which
made the single best twenty seconds of the demo invisible at the moment it
should be most obvious. It now renders blue, tagged **`inert · below floor`**,
with the source's trust on the node.

### 14:43 · Credentials, without leaking them
`scripts/share-env.js` (`npm run team:env`) writes a filled-in `team-env.txt`
for a teammate and prints a masked version to the terminal. `team-env.txt` is
gitignored. The repo is public: an Atlas password in a public commit is burned
the moment it is pushed, and deleting the file afterwards does not un-burn it.

### 14:44 · Timestamp correction, and a NUL byte
`BUILD-LOG.md` and `COORDINATION.md` carried times running roughly ninety
minutes ahead of the commits that contained the work — a log claiming 3:45 PM
against a commit at 14:08. Corrected against `git log`. Judges cross-check the
build log with the commit history, and a log ahead of its own commits reads
worse than no log at all.

---

## Fallback rungs taken, in full

| Layer | Planned | Actually used | Why |
| --- | --- | --- | --- |
| Connection | `mongodb+srv://` | **direct, non-SRV** | the network refuses SRV lookups |
| Embeddings | provider API | **deterministic lexical** | no key configured; determinism is worth more than semantics here, and the run says so |
| Extraction | LLM, temp 0 | **deterministic rules** | LLM path is written and falls back automatically; we demo the rung we are standing on |
| Retrieval | `$vectorSearch` + `filter` | **as planned** | filter fields declared correctly first time |
| Cascade | `$graphLookup` in a transaction | **as planned** | transaction committed |
| Agent loop | graph-shaped with checkpoints | **`runs` document as checkpoint** | every step writes an event before acting |
| Live propagation | change streams | **as planned** | replica set with a primary |
| Voice | live synthesis | **cached mp3 for the stage run** | venue wifi is the least trustworthy thing in the building |

---

## What is left

| # | Item | Owner | Blocking |
| --- | --- | --- | --- |
| 1 | **Film the 60-second video** — five segments, `COORDINATION.md` §8 | Lane C | **Round one** |
| 2 | Rehearse the live run twice on the venue network | Lane B | Round two |
| 3 | Confirm phones reach the laptop on venue wifi — test on arrival, hotspot is the fallback | Lane B | Round two |
| 4 | Submit at 4:40: repo public, video accessible, all three names on the form | Lane C | Submission |
| 5 | Rotate the Atlas password and the ElevenLabs key | Lane A | After the event |

## Cut

Nothing from Tier 1 or Tier 2.

**Not built, and said plainly rather than implied:**

- **LLM extraction and provider embeddings.** No OpenRouter credit. Both paths
  are written and fall back automatically; every run prints the rung it used.
- **LangGraph / `MongoDBSaver` checkpointing.** The loop is graph-shaped by hand
  with a `runs` document as the checkpoint. Adding the dependency at 4 PM was not
  worth the risk.
- **Live re-derivation** — rebuilding the correct conclusions after revoking the
  contaminated ones. This is the right v2 and it does not fit in the window. It
  is a better answer to "what's next" than it would be half-working on stage.

**Never cut, and not cut:** provenance edges, the `$graphLookup` cascade, and the
clean branch staying green.
