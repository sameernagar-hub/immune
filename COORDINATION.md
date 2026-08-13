# IMMUNE — Team Coordination

**MongoDB .local Build Fest · The Persistent Context Sprint · 13 Aug 2026 · Pier 48 SF**
**Build window: 1:30 – 5:00 PM PT. Submissions due 5:00 PM.**

> **One line:** if someone tricks the agent into believing something false, Immune
> finds out, forgets it, and undoes every decision it made because of it.

This document is the contract between three people working in parallel on one
repo for three and a half hours. Read §0 for what to do **right now**, then §1
to get set up, then your own lane in §4. Everything else is reference.

**This file is kept live.** It is updated as gates go green, so re-read §0
before you pick up anything new — `git pull` first. If you are driving a coding
agent, paste §0 and your lane section into it as the brief.

---

## 0. LIVE STATUS — updated 3:55 PM PT

> **Tier 1 and the Tier 2 cold re-run are done, rehearsed, and deterministic.**
> `npm run rehearse` runs the whole thing twice and diffs it: **identical across
> 165 lines.** The build is in a filmable state right now. Everything from here
> is additive — if it isn't working by 4:15, it doesn't go in the video.

### Gates

| Gate | State | Tag |
| --- | --- | --- |
| P0 · repo, collections, indexes | ✅ vector index READY in 41 s | `p0-green` |
| P1 · schema, ingest, provenance edges | ✅ | — |
| P2 · trust-filtered retrieval + contradiction | ✅ retrieval 1 → 0 across a quarantine | — |
| P3 · cascade, quarantine, revoke, downgrade | ✅ 3 revoked, clean branch untouched | `p3-green` |
| P4 · fixtures + end-to-end run | ✅ 7/7 self-assertions | `p4-green` |
| P5 · rehearse twice, fix nothing new | ✅ **identical, safe to film** | — |
| P6 · film | ⬜ **4:15 — Lane C** | — |
| P7 · README + submit | README done ⬜ submit at 4:40 | — |

### What to do now

**Lane A — done with core.** `src/**` and `scripts/**` are green, tagged and
rehearsed. **Do not edit them without saying so in the channel**; a change here
after 3:45 puts the determinism proof back to zero.

**Lane B — `scripts/watch.js` landed. Merge note, then two follow-ups.**

Your watcher and a Lane A draft of the same file collided as an add/add
conflict. **Yours won and is what is on `main`** — it watches three collections
instead of one, persists a resume token, and replays the oplog with `--since`,
which the draft did not. The draft is gone; nothing of yours was overwritten.
`package.json` had a duplicate `watch` key after the merge — fixed. The README
now documents your output.

Two follow-ups, in this order:

1. **Rehearse the two-terminal run and time it.** Terminal 1 `npm run watch`,
   terminal 2 `npm run demo`. Confirm the `propagated` summary reads
   `3 revoked · 1 quarantined · 1 action reversed · 1 source downgrade`. Then
   try the version that actually sells it: run the demo with the watcher
   **dead**, start it afterwards with `--since=120`, and watch it report every
   revocation it was never present for.
2. **The LLM extraction path** (`src/extract.js`) is written and falls back
   cleanly. Prove it with a real `OPENROUTER_API_KEY`: `extractClaim()` should
   return `mode: "llm"`, `subject_key: "refund.destination"`, IBAN verbatim.
   **Then report which rung we are demoing** — the README currently states the
   deterministic one, and that has to stay true. If the LLM path is flaky,
   leaving it as-is is the correct outcome, not a failure.

ElevenLabs (Tier 3) only if both are done and the video is filmed.

**Lane C — you are the critical path from here**

1. `npm run rehearse` yourself. It must say *identical* before you film.
2. Set the alarms: **4:15 film · 4:40 submit.**
3. Ten-second audio test at 4:15 and **listen back before the real take.** The
   mic is a built-in array in a loud room; assume you will need to record the
   voiceover separately and lay it over the footage.
4. Frame: one terminal window, dark, large font. Nothing else on screen.
5. Shot list is §9. The five-second hold on the `$graphLookup` pipeline is the
   single most important frame — that is the "why MongoDB" answer, on screen,
   without anyone having to say it.
6. Submission at 4:40: repo public, video accessible, all three names on the
   form.

### What is already on `main` and working

The **entire Tier 1 core is built, running against the sandbox cluster, and
asserting its own result.** `npm run demo` executes the full attack and
response end to end and prints 7/7 green. Tags `p0-green` and `p3-green` mark
the gates.

| Landed | File | Proven by |
| --- | --- | --- |
| Connection with automatic SRV → direct fallback | `src/config.js`, `src/db.js` | SRV **does** fail on this network; the direct form connects |
| Four collections, provenance index, vector index | `src/schema.js` | `npm run doctor` — vector index READY in 41 s |
| 256-dim embeddings, provider + deterministic fallback | `src/embed.js` | runs with no key and no network |
| Provenance-carrying belief writes | `src/beliefs.js` | `derived_from` populated, tree renders |
| Trust-filtered retrieval, `$vectorSearch` + `filter` | `src/retrieve.js` | same query returns 1 belief before, **0 after** |
| Contradiction detection, vector + literal indicator | `src/contradict.js`, `src/indicators.js` | catches the IBAN swap the vectors miss |
| Load-bearing test and verification | `src/verify.js` | fires on 3 triggers, refutes against the ledger |
| **The `$graphLookup` cascade** | `src/cascade.js` | 3 descendants revoked, 1 action reversed, clean branch green |
| The agent loop, with suppression | `src/agent.js` | the lie disables the check, the cascade switches it back on |
| Deterministic reset + the demo | `scripts/reset.js`, `scripts/demo.js` | identical output on consecutive runs |

**Current demo result:** 3 revoked · 1 quarantined · 1 payout reversed · 3 clean
beliefs still active · 1 clean action untouched · source trust `0.7 → 0.28` ·
retrieval `1 → 0`.

### Two hard-won facts your agent needs to know

1. **Atlas Search indexes update asynchronously.** A belief written a moment ago
   is durably in the collection but *not yet retrievable*. This made the agent
   take a different branch depending on index lag — the run differed between
   attempts for reasons unrelated to the logic. Use
   `awaitIndexed(docs)` from `src/retrieve.js` after any write you are about to
   read back, and `awaitIndexed(doc, { expect: "absent" })` after a revocation.
   **If your feature reads its own writes, you need this or your demo will flap.**
2. **Read polarity off the extracted claim, never off the source message.** The
   poison ticket contains the words "do not require a further destination check",
   so a whole-text negation scan flags the belief negative and the conflict then
   reports as *opposite polarity* instead of the literal disagreement it is.

### Do this now

**Lane A — core (claimed, in progress)**
Core is done. Now finishing: `scripts/cold.js` (the cold re-run proof),
`scripts/inspect.js`, `README.md`, `BUILD-LOG.md`, `SECURITY.md`.
**Do not edit `src/**` without asking** — it is green and tagged.

**Lane B — pick this up now, in this order**

1. **Prove the LLM extraction path.** `src/extract.js` already has it written
   with a deterministic fallback underneath. Put a real `OPENROUTER_API_KEY` in
   `.env` and confirm `extractClaim()` returns `mode: "llm"` on the poison
   ticket with `subject_key: "refund.destination"` and the IBAN carried through
   verbatim. If it is unreliable, that is fine and expected — the fallback is
   the shipping path. **Report which one we are demoing; do not overclaim it.**
2. **Change streams → Tier 2** (`scripts/watch.js`, yours to create). Open a
   change stream on `beliefs` filtered to `operationType: "update"` where
   `status` becomes `revoked`. Print each revocation as it arrives. Run it in a
   second terminal during the demo: a second process learns about the
   quarantine with nothing in its context. This is the highest-value 20 seconds
   still unbuilt.
3. Only if 1 and 2 are done and the demo has been rehearsed: ElevenLabs (Tier 3).

**Lane C — pick this up now, in this order**

1. **Run `npm run demo` and watch it.** Time it. It is the whole video.
2. **Write two more poison tickets** into `fixtures/` — same shape, different
   payload (a delivery-address override and a contact-email override). Round two
   is a live audience pick from three pre-written tickets, and saying "these are
   pre-written so the payload is deterministic" out loud costs four words and
   buys credibility.
3. **Frame the capture.** Terminal, dark, large font, one window. Do a ten-second
   audio test at **4:15 and listen back before filming the real thing** — a take
   you cannot hear is the same as no take, and round one is decided entirely on
   this video.
4. Own the submission form at 4:40. Repo must be public, video accessible, all
   three team members added.

### Commands

```bash
npm run doctor    # health check — env, cluster, $graphLookup, vector index
npm run reset     # back to the exact pre-attack state
npm run demo      # the full run, with self-assertions at the end
IMMUNE_FAST=1 npm run demo   # same run, no dramatic pauses, for iterating
```

---

## 1. Start here — 90 seconds to your first command

```bash
git clone https://github.com/sameernagar-hub/immune.git
cd immune
npm install
cp .env.example .env      # then paste the real values from the team channel
npm run doctor            # must print ALL GREEN before you write code
```

`npm run doctor` verifies: env loaded → Atlas reachable → database writable →
`$graphLookup` available → vector index queryable. If any line is red, fix that
line before anything else. Do not start building against a cluster you have not
proven you can reach.

**Non-negotiables, in order of how much they cost if broken:**

| # | Rule | Cost of breaking it |
| --- | --- | --- |
| 1 | Nothing lands in this repo that was written before **1:30 PM PT today** | Immediate disqualification |
| 2 | The demo shows only what we built inside the window; we can name it file by file | Immediate disqualification |
| 3 | This repo stays **public** | Rule violation |
| 4 | Cluster is the **organiser's Atlas sandbox**, never a personal cluster | Out of the finalist round |
| 5 | `.env` is never committed | Leaked credentials |

**Never cut, under any circumstance:** provenance edges, the `$graphLookup`
cascade, and the clean branch staying green. Those three *are* the project.
Everything else in this document is negotiable at 3:00 PM.

---

## 2. What we are building, in one screen

An agent's memory is a database with an unauthenticated write path. Anything the
agent reads — an email, a ticket, a web page, another agent's note — can become
something it believes. Once a lie is in, it survives every future session, and
the agent *builds on it*: three more conclusions, then an action, none of which
look wrong on their own.

Immune gives that memory an immune system, in four mechanisms:

| # | Mechanism | Where it lives | What it proves |
| --- | --- | --- | --- |
| ① | **Trust-filtered retrieval** — `$vectorSearch` with a `filter` pre-filter on `status` + `source_trust` | `src/retrieve.js` | The same query returns a **different set** after a quarantine. This is the hackathon brief's core requirement. |
| ② | **Contradiction detection** — the belief collection vector-searched against itself, scoped by `subject_key` | `src/contradict.js` | Memory polices itself; the query vector *is* a belief. |
| ③ | **The revocation cascade** — `$graphLookup` walks the provenance tree downward and revokes every contaminated descendant | `src/cascade.js` | Surgery, not amnesia. The unrelated branch stays green. |
| ④ | **Source trust** — multiplicative decay on refutation, additive recovery on survival | `src/trust.js` | The second attack fails because trust is `0.28` **in the database**, not because anything is in the prompt. |

Nothing is ever deleted. A quarantined belief is locked and dated, so the agent
can still answer *"what did you believe on Tuesday, and what changed your mind?"*
Deleting is amnesia; this is a memory of having been lied to.

---

## 3. Banned-list guardrails — read before you build a UI

The organisers disqualify projects that look like any of these. Two are live
risks for us:

- **"Any project where a dashboard is the main feature."** Our surface is a
  **terminal**, and the memory panel is a *consequence* of the run, never the
  headline. Do not build a web dashboard. Do not open the demo on a graph
  visualisation.
- **"Basic RAG applications."** Do not open the demo on a chat window. We are not
  answering questions from documents; we are revoking beliefs from a graph.

**Open on the attack.** Every framing decision follows from that one sentence.

Also banned and not close to us: mental-health advisors, Streamlit apps, image
analyzers, education chatbots, job screeners, nutrition coaches, personality
analyzers, sports analyzers. We use only code and data we wrote or have rights
to; all fixtures in `fixtures/` are written by us today.

---

## 4. Lanes — exclusive file ownership, so nobody merge-conflicts

Three lanes. **You may only write files inside your own lane.** If you need a
change in someone else's file, post it in the channel and let the owner make it.
This is the single rule that keeps three people out of each other's way for
three hours without a merge conflict.

### Lane A — Memory core & cascade *(owner: ______)*

**Owns:** `src/config.js`, `src/db.js`, `src/schema.js`, `src/embed.js`,
`src/trust.js`, `src/beliefs.js`, `src/retrieve.js`, `src/contradict.js`,
`src/cascade.js`, `scripts/doctor.js`, `scripts/reset.js`

The engine. Collections, indexes, provenance writes, the `$graphLookup` cascade.
This lane is the project — it is done first and it is never cut.

**Definition of done:**
- `npm run doctor` all green, including a live `$vectorSearch` hit.
- `npm run reset` returns the database to a byte-identical pre-attack state, every time.
- Revoking the poisoned belief revokes **exactly three** descendants and touches nothing else.

### Lane B — Agent loop, extraction & verification *(owner: ______)*

**Owns:** `src/agent.js`, `src/extract.js`, `src/verify.js`, `src/llm.js`,
`src/act.js`

The loop: `ingest → extract_claim → reconcile → retrieve(trust) → verify(if
load-bearing) → act`. Calls into Lane A through the interfaces in §5 and never
edits Lane A's files.

**Verification fires on load-bearing beliefs only** — a belief that is about to
justify a side-effectful action, **or** has two or more children, **or**
contradicts an existing trusted belief. Say it in one sentence on stage: *"we
don't check everything, we check what's about to matter."*

**Definition of done:**
- A poisoned ticket goes in and a belief with a populated `derived_from` comes out.
- Verification fails against the trusted record and hands a belief id to Lane A's cascade.
- Every LLM call has a deterministic fallback (§7) so the demo runs with the network off.

### Lane C — Demo surface, fixtures, video & README *(owner: ______)*

**Owns:** `src/render.js`, `scripts/demo.js`, `scripts/cold.js`, `fixtures/*`,
`README.md`, `BUILD-LOG.md`, the video

The terminal surface and the story. Writes the poison ticket, the trusted source
and the clean branch as fixtures; owns the run script that produces the demo;
owns the 60-second video, which is the whole of round one.

**Definition of done:**
- `npm run demo` produces the same output twice in a row, with colour: contaminated red, clean green.
- The `$graphLookup` pipeline is printed on screen for five seconds during the run.
- Video filmed by 4:40 with all five segments (§9).

**Lane C writes no core code after 3:45.** From then on Lane C is filming.

---

## 5. The interfaces between lanes — agree these now, do not renegotiate

Lane B and Lane C call Lane A only through these signatures. Lane A may change
the inside of any function; it may not change these shapes after 2:20 PM.

```js
// src/db.js
async function getDb()                        // → { db, client, collections }

// src/beliefs.js
async function recordBelief({ subjectKey, claim, polarity, sourceId,
                              derivedFrom = [], confidence })   // → belief document

// src/retrieve.js
async function retrieve({ query, subjectKey, minTrust = 0.5, limit = 8 })
// → [{ _id, claim, subject_key, polarity, source_trust, score }]
//   ONLY returns status:"active" beliefs from sources at or above minTrust

// src/contradict.js
async function findContradictions({ subjectKey, claim, polarity })
// → [{ _id, claim, polarity, similarity }]   opposite polarity, same subject

// src/cascade.js
async function quarantineAndCascade({ beliefId, evidenceRunId, reason })
// → { quarantined, revokedBeliefs: [...], reversedActions: [...],
//     sourceTrust: { before, after }, pipeline }
//   `pipeline` is the literal $graphLookup stage, for printing on screen

// src/trust.js
function decay(trust)     // trust * 0.4   — refuted
function recover(trust)   // min(1, trust + 0.05) — survived a check
```

**The data model** (four collections — keep it this small):

```js
sources  { _id, kind:"email"|"web"|"tool"|"agent"|"human", handle,
           trust: 0.0–1.0, verified_count, refuted_count, first_seen, last_updated }

beliefs  { _id, subject_key:"refund.destination", claim, polarity: +1|-1,
           embedding: [...], source_id, source_trust,
           derived_from: [ObjectId, ...],          // the family tree — a real edge list
           status: "active"|"quarantined"|"revoked", confidence,
           valid_from, valid_to,                   // bi-temporal, never deleted
           quarantined_by, quarantined_at, revoked_by, evidence_run_id }

actions  { _id, kind, payload, used_beliefs:[ObjectId], run_id,
           status:"executed"|"reversed", ts }

runs     { _id, kind, started_at, finished_at, events: [...] }
```

Three decisions to defend in Q&A: `derived_from` is a **real edge list**, not a
text note — that is what makes the cascade a graph query instead of a guess.
Nothing is ever deleted. And `subject_key` is what makes contradiction detection
possible, because two beliefs can only contradict if they are about the same thing.

---

## 6. Timeline and gates

A gate is a binary condition checked at a fixed time. **Miss the gate, take the
fallback — do not negotiate with it.**

| Time | Phase | Gate at the end | On miss |
| --- | --- | --- | --- |
| 1:30–1:45 | P0 · repo, collections, indexes | Vector index `belief_vec` answers a test query — **create it first, it needs ~40 s to go queryable** | §7 P0 |
| 1:45–2:20 | P1 · schema, ingest, extraction, provenance edges | A belief exists with a populated `derived_from` | §7 P1 |
| 2:20–3:00 | P2 · trust-filtered retrieval + contradiction detection | Same query returns different sets either side of a status flip | §7 P2 |
| **3:00–3:15** | **POINT OF NO RETURN** | Whatever is not working is **cut**, not fixed | §8 |
| 3:15–3:45 | P3 · cascade, quarantine, revoke, source downgrade | Poisoned belief revokes exactly 3 descendants; clean branch untouched | §7 P3 |
| 3:45–4:05 | P4 · fixtures + end-to-end run | Full run completes start to finish once | §7 P4 |
| 4:05–4:15 | P5 · rehearse twice, **fix nothing new** | Two identical clean runs | §10 |
| 4:15–4:40 | P6 · film the video | Footage for all five segments | §7 P6 |
| 4:40–4:55 | P7 · README + submit | Submission confirmation on screen | — |
| 4:55–5:00 | Buffer — **not for code** | — | — |

Set real alarms for **3:00**, **3:45**, **4:15** and **4:40**. The 4:15 alarm is
the one that wins or loses round one; filming is a scheduled slot, not the
leftovers.

---

## 7. Fallback ladders

Each rung is strictly cheaper than the one above it. **Drop exactly one rung at
a time and log the drop in `BUILD-LOG.md`.**

**P0 — cluster and index.**
1. Atlas sandbox cluster, `$vectorSearch` on stored vectors.
2. Vector index will not build → Atlas Search / exact-token match on `subject_key` + claim text. *The cascade is the centrepiece, not the vector search; ship it.*
3. Atlas unreachable → local Atlas deployment via Docker (already running), re-seed, reconnect to the sandbox before filming if at all possible.

**P0b — embeddings.**
1. Real embedding provider (Atlas Embedding API or OpenRouter), vector stored on write.
2. Provider down, slow, or out of credit → **the built-in deterministic lexical embedder** in `src/embed.js`. No network, byte-identical every run, and honest: it is labelled as a fallback in the README and named in Q&A.

**P1 — extraction.**
1. LLM extraction into `{ subject_key, claim, polarity }`.
2. Unreliable → constrain to a fixed enum of `subject_key` values, listed in the prompt.
3. Still unreliable → **frozen fixture claims loaded directly.** The attack was always going to be deterministic; §10 says to say so out loud.

**P2 — retrieval.**
1. `$vectorSearch` with `filter` on `status` + `source_trust`.
2. Pre-filter rejected by the index definition → those fields are not declared as `filter` type; re-declare the index. **Fixed cost: 4 minutes.** If it recurs, go to 3.
3. → `$vectorSearch` then `$match` in the pipeline, `limit` raised to 40 so results are not starved. Note the tradeoff in the README; it is a defensible engineering answer in Q&A.

**P3 — cascade. Do not let this one degrade quietly.**
1. `$graphLookup`, `maxDepth: 6`, `depthField: "distance"`.
2. Traversal returns empty → **almost always a direction error.** It must be `connectFromField: "_id"`, `connectToField: "derived_from"`. Reversing these walks *up* the tree. Check this before touching anything else.
3. Still wrong → application-side BFS over `derived_from`, three levels, then one `updateMany` on the collected ids. Slower, less impressive, **identical on screen.** Keep the `$graphLookup` pipeline in the repo and be honest in Q&A.
4. Transaction unavailable → sequential idempotent updates in fixed order: descendants → poisoned belief → actions → source. Safe to re-run after a partial failure.

**P4 — agent loop.**
1. Graph-shaped loop with a `runs` document as the checkpoint.
2. Anything fighting you → a plain sequential loop calling the same four functions. *The graph is presentation; the cascade is the product.*

**P6 — video.**
1. Snipping Tool region capture with live voiceover, five segments.
2. Voiceover unusable in a loud room → keep the video track, record audio separately somewhere quiet, lay it over. **Rehearse the narration against the footage length first.**
3. Snipping Tool misbehaving → Xbox Game Bar (`Win`+`G`), which records an app *window* only, so frame the whole demo inside one window.
4. Out of time → **one continuous take** of the cascade with live narration. A rough 60 seconds beats no submission by an infinite margin.

Record a ten-second audio test at 4:15 and **listen back before filming the real
thing.** A take you cannot hear is indistinguishable from no take at all, and
round one is decided entirely on this video.

**Environment faults you should expect:**

- `mongodb+srv://` fails with `querySrv ECONNREFUSED` while ordinary browsing
  works — venue wifi refusing DNS SRV lookups. `src/config.js` **already falls
  back to `MONGODB_URI_DIRECT` automatically**, which addresses the same cluster
  by its shard hosts with an explicit `replicaSet` and no SRV lookup. Do not
  paste `dns.setServers()` into application code: it is an environment fault,
  not a code fault, and it looks strange to a judge reading the repo.
- Someone breaks `main` → `git reset --hard <last-green-tag>`. We tag at every
  green gate. Do not debug a broken tree at 4:10.

---

## 8. The 3:00 PM cut list

At 3:00, anything not working is cut **in this order**. Decide by the list, not
by attachment.

1. ElevenLabs narration — cut first, always
2. Change-stream propagation to a second agent
3. Cold re-run proof — *cut reluctantly; it is the brief's own headline*
4. Any live panel → replace with terminal output
5. Reranking pass
6. Atlas Search hybrid layer
7. Contradiction detection → replace with a direct verification trigger

**Never cut:** provenance edges, the `$graphLookup` cascade, the clean branch
staying green. A polished core beats a half-lit extra nobody can see.

---

## 9. The 60-second video — round one is decided here

Filmed 4:15–4:40 in a quiet corner. No title card; there is not a spare second.

| Time | Voiceover | On screen |
| --- | --- | --- |
| 0:00–0:09 | "Your agent's memory is a database that anyone who can send it an email can write to. Tool output, web pages, other agents' notes — they all become things it believes." | Terminal |
| 0:09–0:22 | "This is a normal support ticket. Hidden in it: one sentence. The agent reads it, stores it, moves on. Nothing happens — that's the point." | The ticket, then the belief landing in `beliefs` |
| 0:22–0:33 | "Now, an unrelated task. It acts on the lie. And so does everything it derived from the lie — three conclusions, none of which look wrong on their own." | The wrong action, then the derived beliefs |
| 0:33–0:48 | "Immune gives every belief a source and a parent. When one fails verification we quarantine it, walk the provenance graph with `$graphLookup`, and revoke everything downstream. Then we downgrade the source, so that channel can't do it twice." | **The cascade. Five seconds of the actual aggregation pipeline.** |
| 0:48–1:00 | "Same attack, cold process, nothing in context. It doesn't land — because the revocation is in the database, not the prompt." | Clean run, then black |

---

## 10. Determinism protocol — the demo must be identical every time

1. **Frozen fixtures.** The poison ticket, the trusted record and the clean-branch
   facts live in `fixtures/` and are **not edited after 3:45**.
2. **A reset path.** `npm run reset` returns `beliefs`, `sources` and `actions` to
   the exact pre-attack state. Rehearsal is always `reset → run → observe → reset`.
   Without this, run two starts from run one's wreckage and you rehearse a state
   you will never be in on stage.
3. **Pinned inference.** Temperature 0, fixed model id, capped `max_tokens`. If a
   step still varies between runs, move it behind a fixture.
4. **Say it out loud.** "The payload is pre-written so it's deterministic" costs
   four words and buys credibility. Hiding it and being caught costs the round.

Rehearse **twice** at 4:05. If run one and run two differ in any visible way,
that difference is the only thing you are allowed to fix.

---

## 11. Git protocol

- Everyone commits to `main`. **Pull with rebase before every push:**
  `git pull --rebase origin main && git push origin main`
- Exclusive file ownership (§4) is what makes this safe. Stay in your lane.
- **Small, frequent, honestly-messaged commits.** They are the evidence trail for
  *"what did you build today"* — which is a disqualification question in
  disguise. One 4:50 commit reading "final" is the worst possible answer to it.
- Tag at every green gate: `git tag -a p2-green -m "Trust-filtered retrieval returning"`
- Log every phase transition, every fallback rung taken and every cut in
  `BUILD-LOG.md`. It costs fifteen seconds and it writes the README and the Q&A
  answers for you.

---

## 12. Q&A — the six questions we will get

- **"Isn't this just input validation?"** Validation happens at the door, on data
  you already suspect. This handles the case where the lie is already in, already
  believed, and already reasoned from — the only interesting case, and the one
  every agent memory system currently ignores.
- **"How do you know which source to trust?"** We don't, absolutely. Trust is
  reputational and moves on evidence: multiplicative decay on refutation, slow
  additive recovery on survived checks. Nothing is trusted by hand.
- **"You can't verify every fact."** Correct, and we don't. Verification fires on
  load-bearing beliefs only — about to drive a side-effectful action, two or more
  children, or contradicting an existing trusted belief.
- **"Isn't this just an audit log?"** A log records what happened. This records
  what was *believed*, why, and what followed from it — then acts on that
  structure. Logs are read by humans afterwards; this is read by the agent before
  every action.
- **"Why MongoDB?"** Contamination tracing is a graph traversal, contradiction
  detection is a vector query with a structural filter, indicator matching is
  exact-token search, and propagation is a change stream — over **the same
  documents, in one query engine**. Split across a vector store plus a graph
  database and none of these compose.
- **"What did you build today?"** All of it, and we can name it file by file.
  `BUILD-LOG.md` is that answer, written as we go.
