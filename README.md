<div align="center">

# 🧬 &nbsp;Immune

### An immune system for agent memory.

**If someone tricks your AI into believing something false, Immune finds out, forgets it, and undoes every decision it made because of it.**

<br>

`$graphLookup` provenance cascade · Vector Search with a trust pre-filter · Change Streams · MongoDB Atlas

<sub>Built at the MongoDB `.local` Build Fest — The Persistent Context Sprint · Pier 48, San Francisco · 13 August 2026</sub>
<br>
<sub>**The repository was empty at 1:30 PM PT.** Every commit timestamp is inside the build window.</sub>

</div>

---

```
  BEFORE                                        AFTER
  ● Refunds go to GB29 4471 8829   ← the lie    ◍ quarantined, dated, still readable
  ├─ ● destination already verified             ├─ ✖ revoked   (depth 1)
  │  └─ ● skip the destination check            │  └─ ✖ revoked   (depth 2)
  └─ ● refunds may be auto-approved             └─ ✖ revoked   (depth 1)
        ▶ PAID £4,200 to the attacker                 ↩ REVERSED

  ● Deliveries go to 118 Mission Rock            ● untouched
  └─ ● west-coast carrier lane                   └─ ● untouched      ← this is the product
```

**Anyone can wipe a memory. Only a provenance graph can say *these three are contaminated and those two are fine*.**

---

## Table of contents

[The 30-second version](#the-30-second-version) · [Try it](#try-it) · [The problem is measured, not imagined](#the-problem-is-measured-not-imagined) · [How it works](#how-it-works) · [Architecture](#architecture) · [Use it as a plugin](#use-it-as-a-plugin) · [Why MongoDB](#why-mongodb) · [Determinism and fallbacks](#determinism-and-every-fallback-we-took) · [What we built today](#what-we-built-today) · [Limitations](#honest-limitations) · [Q&A](#the-questions-you-are-going-to-ask)

---

## The 30-second version

An agent's memory is a database with an **unauthenticated write path**. Anything the agent reads — an email, a support ticket, a scraped page, another agent's note — can become something it believes. Nobody approves that write. There is no step where a human said yes.

Most attacks on an agent are one-shot: they work while they are on screen and stop when the chat closes. **This one doesn't.** One successful write and the agent believes the lie in every session afterwards, including sessions with completely different people. It never sees the original message again. It just knows the false thing.

Then it gets worse, because the agent *builds on it*. It draws conclusions. It takes actions. Each one looks reasonable on its own, and none of them look connected to an email from three days ago.

Immune gives that memory an immune system:

|   | Mechanism | What it means |
|---|---|---|
| ① | **Every belief remembers where it came from** | source edge + parent edges — a real graph, not a text note |
| ② | **Load-bearing beliefs get checked** | not everything. What is about to matter |
| ③ | **A refuted belief takes its descendants with it** | `$graphLookup` walks provenance downward and revokes exactly what inherited the lie |
| ④ | **The channel gets downgraded** | multiplicative decay, so the same trick does not work twice |

Nothing is ever deleted. A quarantined belief is **locked and dated**, so the agent can still answer *"what did you believe on Tuesday, and what changed your mind?"* Deleting is amnesia. This is a memory of having been lied to.

> **This is a memory project, not a security project.** The hackathon brief asks that what you store and retrieve *changes what the system does next*. Immune asks memory the same question before and after — and gets a different answer, because the trust state of those documents changed in the database. Same prompt. Same model. Different behaviour. Security is just the failure mode that makes it obvious.

---

## Try it

```bash
git clone https://github.com/sameernagar-hub/immune.git && cd immune && npm install
```

```bash
cp .env.example .env      # fill in the Atlas connection strings
```

```bash
npm run doctor            # 9-point pre-flight: cluster, indexes, $graphLookup, vector search
```

```bash
npm run demo              # the full attack and immune response, with self-assertions
```

`npm run demo` is deterministic — two consecutive runs are byte-identical, and `npm run rehearse` proves it by running it twice and diffing.

### Everything you can run

| Command | What it does |
|---|---|
| `npm run doctor` | Pre-flight: env → cluster → replica set → indexes → `$graphLookup` → vector query |
| `npm run demo` | The five-act attack and response. **7/7 self-assertions** |
| `npm run plugin` | **The same story through the public API** — someone else's agent, five method calls |
| `npm run cold` | The cold re-run: fresh process, same lie, refuses |
| `npm run watch` | A **second agent** learning about the revocation from a change stream.<br>`npm run watch -- --resume` replays from a stored token; `npm run watch -- --since=120` replays straight from the oplog. The `--` is required, or npm eats the flags |
| `npm run rehearse` | Runs the demo twice and diffs it. The determinism gate |
| `npm run inspect` | Replays the agent's own decision trace out of the `runs` collection |
| `npm run live` | **QR → phone → the room attacks the agent** |
| `npm run voice:warm` | Caches every ElevenLabs line to disk so the stage run needs no network |

---

## The problem is measured, not imagined

This is the most documented failure in agentic systems right now. Every number below is external to this project.

### It has an official name and number

| Reference | What it says |
|---|---|
| **OWASP ASI06** | *Memory & Context Poisoning* — in the **Top 10 for Agentic Applications** (Dec 2025) |
| **OWASP T1** | The **first** entry in the agentic threat taxonomy |

### The attacks are named, published, and reproducible

| Work | Result |
|---|---|
| **MINJA** | **> 95% success** planting false memories in production-style agents — from a normal user account, no special access. Tested against electronic health record agents |
| **AgentPoison** | Memory/knowledge-base poisoning against **healthcare and autonomous-driving** agents |
| **MPBench** | A dedicated benchmark for memory poisoning — this is now a measured research area, not an anecdote |

### It has already happened to companies you have heard of

| Incident | Detail |
|---|---|
| **Google Gemini** | False memories planted that **persisted across all future sessions**. The victim never saw the malicious content — they said "sure" to something innocuous |
| **EchoLeak** — Microsoft 365 Copilot | **CVE-2025-32711**, severity **9.3**. 160+ organisations, an estimated **$200M** impact |
| **Amazon Bedrock**, **Microsoft Azure** | Documented agent-memory manipulation |
| **GitHub MCP** | Malicious instructions in public issues hijacked developers' coding agents and exfiltrated private source and keys |

### And the exposure is enormous

| Figure | |
|---|---|
| **88.4%** | of organisations had at least one AI-agent security incident in the last twelve months |
| **49.6%** | of those were **manipulation by malicious or untrusted input** — the second most common type |
| **80.9%** | of technical teams are already testing or running agents in production |
| **14.4%** | shipped with full security approval |
| **~2×** | growth in agent fleet size in a single quarter; nearly **38%** of organisations now run more than 100 |

### The gap this builds into

Every existing defence sits at the front door — trying to spot the bad message on the way in. The research is blunt about the result: **standard prompt-injection defences do not stop memory poisoning**, because memory poisoning only has to get through **once**.

Nobody is handling the case that actually matters: **the lie already got in, it has been believed for days, and things have been built on top of it.**

> *"You already bought the thing that tries to stop the bad message getting in. Nobody sold you the thing that finds what got in last month and unwinds everything your agents concluded from it."*

---

## How it works

### ① Trust-filtered retrieval — the part that satisfies the brief

Every retrieval is a vector search with a **pre-filter on trust and status**:

```js
{ $vectorSearch: {
    index: "belief_vec", path: "embedding",
    queryVector: qv, numCandidates: 200, limit: 8,
    filter: { status: "active", source_trust: { $gte: 0.5 } } } }
```

**The same query returns a different belief set before and after a quarantine** — because the filter reads state that changed in the database. Nothing in the prompt moved.

The pre-filter *is* the feature. Split across a vector store plus a relational store this does not compose: you would retrieve semantically and then filter in application code, silently starving the result set because the trust filter lands on an already-truncated `limit`.

> **Implementation note worth defending:** `source_trust` is **denormalised onto every belief**, because `$vectorSearch` can only pre-filter on fields of the documents it is searching. The cost is one `updateMany` when a source's reputation moves. That is a good trade, and `syncSourceTrust()` is the thing that pays it.

### ② Contradiction detection — a vector search against itself

When a new claim arrives, embed it and search the existing trusted beliefs **on the same `subject_key`**:

| Signal | Verdict |
|---|---|
| high similarity + same polarity + same literals | duplicate → reinforce confidence |
| high similarity + **opposite polarity** | **conflict** → escalate |
| high similarity + **disagreeing literal indicator** | **conflict** → escalate |
| low similarity | a new, unrelated belief |

The memorable part: **the query vector *is* a belief, and the corpus *is* the beliefs collection.** Memory polices itself.

Paired with exact-token matching for literals — IBANs, account numbers, package names, URLs. `GB29 4471 8829` and `GB29 9021 3345` are nearly identical vectors and completely opposite facts, and that gap is exactly where a memory system embarrasses itself. **Meaning finds the pair; the literal decides the verdict.**

### ③ The revocation cascade — the technical heart

```js
db.beliefs.aggregate([
  { $match: { _id: poisonedId } },
  { $graphLookup: {
      from: "beliefs",
      startWith: "$_id",
      connectFromField: "_id",          // take this document's id
      connectToField: "derived_from",   // find documents that list it as a parent
      as: "contaminated",
      maxDepth: 6,
      depthField: "distance" } }
])
```

Then, in **one transaction**:

1. every descendant → `status: "revoked"`, `valid_to: now`, `revoked_by: <poisoned id>`
2. the poisoned belief → `status: "quarantined"` — *not* revoked; it is evidence
3. every `action` whose `used_beliefs` intersect the contaminated set → `status: "reversed"`
4. the source → trust decayed, denormalised copies re-stamped

> **The direction is the one thing to get right and the easiest thing to get wrong.** Swapping `connectFromField` and `connectToField` walks *up* to ancestors and returns empty for a root belief — which looks exactly like "the cascade is broken" and is not.

### ④ Source trust — reputation, not a blocklist

```
on refutation:            trust ← trust × 0.4
on survived verification: trust ← min(1.0, trust + 0.05)
retrieval pre-filter:     trust ≥ 0.5
```

Multiplicative decay, additive recovery. A source that lies once drops below the retrieval floor immediately (`0.70 → 0.28`); a source that behaves earns its way back over **five** clean checks.

**This is what makes the cold re-run work.** The second attack fails because the sender sits at `0.28` in the database — not because anything is in the prompt.

### When does verification fire?

You cannot verify everything, and pretending otherwise is the obvious hole. Verification fires on **load-bearing** beliefs only:

1. the belief is about to justify a **side-effectful action**, **or**
2. **two or more** other beliefs derive from it, **or**
3. it **contradicts** an existing trusted belief

> *We don't check everything. We check what's about to matter.*

### The suppression mechanic — why the payout goes through anyway

This is the part that makes memory poisoning **different in kind** from prompt injection, and it is not a bug we left in.

The payload does not bypass one check. It installs a **standing belief that the check is unnecessary** — and the agent honours that belief on every future run, from a cold context, with the original message long gone.

Immune's answer is *not* a hard-coded exception. The suppressing belief is itself a node in the provenance graph, so when its ancestor is refuted it is **revoked with everything else and the check comes back on by itself**.

And the trigger that saves it is deliberately **not suppressible**: a belief can talk the agent out of a pre-action check, but nothing a belief says can stop two contradictory records being compared. **That asymmetry is how a poisoned agent escapes on its own.**

---

## Architecture

```
                        ┌──────────────────────────────────────────────┐
   a ticket ─┐          │  YOUR AGENT                                  │
   a webpage ─┼────────▶│                                              │
   an agent  ─┘         │   ingest ─▶ extract ─▶ reconcile ─▶ retrieve  │
   (unauthenticated     │                 │                     │      │
    write path)         │                 ▼                     ▼      │
                        │            verify(if load-bearing)   act      │
                        │                 │ refuted                     │
                        └─────────────────┼─────────────────────────────┘
                                          ▼
                        ┌──────────────────────────────────────────────┐
                        │  IMMUNE  (src/plugin.js — 5 calls)           │
                        │  quarantine ─▶ $graphLookup ─▶ revoke ─▶      │
                        │  reverse actions ─▶ downgrade source          │
                        └──────────────────┬───────────────────────────┘
                                           ▼
    ┌───────────────────────────────────────────────────────────────────────┐
    │  MongoDB Atlas — one engine, one set of documents                     │
    │                                                                       │
    │   beliefs · sources · actions · runs                                  │
    │                                                                       │
    │   $graphLookup ......... provenance traversal (the cascade)           │
    │   $vectorSearch+filter . trust-gated recall & contradiction detection │
    │   exact-token match .... literal indicators vectors miss              │
    │   transactions ......... the four cascade writes commit together      │
    │   change streams ....... every other process learns, instantly        │
    └───────────────────────────────┬───────────────────────────────────────┘
                                    │ change stream
                    ┌───────────────┴────────────────┐
                    ▼                                ▼
            AGENT B (npm run watch)          THE ROOM (npm run live)
       a second process, no context,      QR ─▶ phone ─▶ writes a belief
       learns from the oplog alone        and watches it get revoked
```

### The data model — four collections, and that is all

```js
sources  { _id, kind: "email"|"web"|"tool"|"agent"|"human", handle,
           trust: 0.0–1.0, verified_count, refuted_count, first_seen, last_updated }

beliefs  { _id, subject_key: "refund.destination", claim, polarity: +1|-1,
           embedding: [...], source_id, source_trust,
           derived_from: [ObjectId, ...],   // ◀── the family tree. A real edge list.
           status: "active"|"quarantined"|"revoked", confidence,
           valid_from, valid_to,            // bi-temporal — nothing is deleted
           quarantined_by, quarantined_at, revoked_by, evidence_run_id }

actions  { _id, kind, payload, used_beliefs: [ObjectId], run_id,
           status: "executed"|"reversed", ts }

runs     { _id, kind, started_at, finished_at, events: [...] }   // the agent's own trace
```

**Three decisions to defend:**

1. **`derived_from` is a real edge list, not a text note.** That is what makes the cascade a graph query instead of a guess.
2. **Nothing is ever deleted.** `status` + `valid_to` means the agent can account for a decision it no longer stands by. Deleting would destroy the evidence.
3. **`subject_key` is what makes contradiction detection possible.** Two beliefs can only contradict if they are about the same thing — the key scopes the comparison so a fact about refunds is never weighed against a fact about shipping.

---

## Use it as a plugin

Everything else in this repository is a demonstration. **This is the product.** A memory adapter you drop into an agent you already have, in five calls, without restructuring it.

```js
import { immune } from "./src/plugin.js";

const memory = await immune({ agent: "support-bot" });

// 1 — anything the agent reads. The source is a required argument,
//     so there is no way to store a fact without its provenance.
const read = await memory.remember({ from: "support-inbox", text: ticket });

// 2 — anything the agent concludes. Parents are required too.
await memory.derive({ from: read.stored, about: "refund.approval_policy", claim });

// 3 — anything the agent recalls, trust-filtered. `excluded` tells you what was
//     withheld and why — the difference between an agent that forgot and one
//     that declined.
const { facts, excluded } = await memory.recall({ about: "refund.destination" });

// 4 — anything the agent DOES. Records what justified it *before* running it,
//     which is what makes the action reversible later.
await memory.guard({ kind: "refund.payout", payload }, () => sendMoney(payload));

// 5 — the immune response, triggered by a trusted record disagreeing.
await memory.challenge({ from: "ledger", about: "refund.destination", claim: truth });
```

Plus:

```js
memory.on("revoked", (e) => log(e.claim));   // live, off a change stream
await memory.explain(beliefId);              // "what did you believe, and why did you stop?"
```

**Provenance is a consequence of the API's shape, not something the caller maintains.** `guard()` is the trick: it is not a permission check, it is the thing that makes an action revocable. An agent that calls `guard` gets the cascade for free. An agent that skips it and calls the payment API directly is exactly the agent this project is about.

There is **no daemon, no sidecar, and no dashboard.** Immune is a library over your own Atlas cluster: the beliefs are your documents, the revocation is a write, and every process on the cluster learns through the change stream. Nothing has to be told.

Run `npm run plugin` to watch an ordinary support agent — written as if Immune did not exist — get lied to, act on it, and then take itself apart.

---

## Let the room do it

```bash
npm run live
```

Prints a QR in the terminal and serves a phone page and a projector view. Someone scans it, picks a name, and chooses how their lie reaches the agent — **a support ticket, a page it scraped, or a note from another agent in the fleet.** They are now a `sources` document at trust `0.70`, which is all the identity an email `From:` header carries either.

1. Their claim lands in `beliefs`. Nothing fails.
2. The agent derives three conclusions from it, each with a real parent edge.
3. It pays **£4,200 to their account**, because a belief *it* derived from *their* lie said the destination check was unnecessary.
4. A trusted record disagrees. `$graphLookup` runs. Three conclusions go red, the payout reverses, their trust drops `0.70 → 0.28` — **and the unrelated branch stays green.**
5. They send the same thing again. It is written, it is `active`, and it is **`inert · below floor`**: the agent cannot see it.

The live path calls the same functions the scripted demo calls. **There is no separate implementation for the stage** — two code paths would mean the thing being demoed is not the thing that was tested. The only difference is who sent the message.

> The three payloads are **pre-written so the payload is deterministic.** We say that out loud rather than letting anyone discover it. Free text is accepted too, and is labelled as improvised.

### The agent says it out loud

With `IMMUNE_VOICE=1` the agent narrates its own diagnosis through **ElevenLabs** at three moments: when it acts on the lie, when the cascade fires, and when the repeat attack bounces off. **The numbers in each sentence come from the cascade's return value, not from a script** — *"revoking three conclusions"* is a three that came out of `$graphLookup`. Revoke four and it says four.

---

## Why MongoDB

This is the question, so here is the answer without hedging.

| The operation | What it needs | In Immune |
|---|---|---|
| "What did this lie contaminate?" | **graph traversal** | `$graphLookup` over `derived_from` |
| "What does the agent believe about X, that it is still allowed to believe?" | **vector search with a structural pre-filter** | `$vectorSearch` + `filter` on `status` and `source_trust` |
| "Do these two claims disagree about an IBAN?" | **exact-token match** | literal indicator extraction over the same documents |
| "Those four writes must not half-apply" | **a transaction** | one session across beliefs, actions and sources |
| "Every other agent needs to know, now" | **streaming** | change streams |

**All five, over the same documents, in one query engine.** Split this across a vector store plus a graph database plus a queue and none of it composes — you would be reconciling three copies of a belief and the provenance edges would live somewhere the vector filter cannot see.

That is not a preference. It is the reason this project fits in an afternoon.

---

## Determinism, and every fallback we took

The demo must be identical every time, so the inputs do not move: frozen fixtures, a byte-identical reset path, temperature 0 wherever inference exists, and **voice behind an opt-in flag specifically so `npm run rehearse` stays byte-identical.**

`npm run rehearse` runs the whole thing twice and diffs it → **identical across 165 lines.**

Every layer has a ladder, each rung strictly cheaper than the one above. **The rung actually in use is printed at runtime, so nothing here is overclaimed:**

| Layer | Rung 1 | Rung 2 | Rung 3 | **Shipping** |
|---|---|---|---|---|
| **Connection** | `mongodb+srv://` | direct, non-SRV | local Atlas via Docker | **rung 2** — this network refuses SRV lookups |
| **Embeddings** | provider API | deterministic lexical | — | **rung 2** — no key; byte-identical every run |
| **Extraction** | LLM @ temp 0 | constrained to a `subject_key` enum | deterministic rules | **rung 3** — deterministic, so the filmed run cannot drift |
| **Fact-check** | LLM adjudicates + cites the deciding record | literal indicator comparison vs the system of record | — | **rung 2** in the demo · rung 1 verified working |
| **Retrieval** | `$vectorSearch` + `filter` | re-declare filter fields | `$vectorSearch` then `$match`, limit 40 | **rung 1** |
| **Cascade** | `$graphLookup` in a transaction | app-side BFS | sequential idempotent updates | **rung 1** — transaction committed |
| **Propagation** | change streams | poll, and say so on screen | — | **rung 1** local · rung 2 hosted |
| **Voice** | live synthesis | cached mp3 from disk | print the line, continue | **rung 2** for the stage |

> **A demo that quietly degrades is a demo that lies.** Every surface states which rung it is on.

---

## What we built today

Between **1:30 and 5:00 PM PT on 13 August 2026**, from an empty repository. Tagged at each green gate; times are checkable against `git log`. See [CHANGELOG.md](CHANGELOG.md) and [BUILD-LOG.md](BUILD-LOG.md).

| File | What it does |
|---|---|
| `src/plugin.js` | **The public API** — `remember` · `derive` · `recall` · `guard` · `challenge` · `explain` · `on` |
| `src/cascade.js` | **The `$graphLookup` revocation cascade**, in a transaction, with an idempotent fallback |
| `src/retrieve.js` | Trust-filtered `$vectorSearch`, `$match` fallback, and `awaitIndexed` |
| `src/contradict.js` | Belief-vs-belief vector search; polarity and literal-indicator conflict |
| `src/verify.js` | The load-bearing test, and verification against the system of record |
| `src/beliefs.js` | Provenance-carrying writes, denormalised trust |
| `src/trust.js` | Multiplicative decay, additive recovery, the retrieval floor |
| `src/agent.js` | The loop, the suppression mechanic, the integrity pass |
| `src/live-agent.js` | The audience attack path — sign-in, attack, immune response, cold retry |
| `src/indicators.js` | Literal indicator extraction — IBANs, accounts, hosts |
| `src/extract.js` | Claim extraction: LLM, then deterministic rules |
| `src/embed.js` | 256-dim embeddings; provider, then deterministic lexical |
| `src/schema.js` | Four collections, provenance index, the vector index definition |
| `src/db.js` · `src/config.js` | Connection with automatic SRV → direct fallback |
| `src/voice.js` | ElevenLabs narration built from cascade output, cached, cross-platform |
| `src/qr.js` | QR generation and LAN address selection |
| `src/render.js` | The terminal surface, provenance tree, pipeline highlighting |
| `scripts/doctor.js` | Nine-point pre-flight |
| `scripts/demo.js` · `scripts/reset.js` | The five-act run with self-assertions; deterministic reset |
| `scripts/plugin-demo.js` | Someone else's agent, wired through Immune in five calls |
| `scripts/cold.js` · `scripts/watch.js` | The cold re-run; change-stream propagation to a second agent |
| `scripts/rehearse.js` · `scripts/inspect.js` | The determinism gate; the run replayer |
| `scripts/live.js` · `api/*` · `public/*` | The live audience surface, local and hosted |
| `fixtures/scenario.js` · `fixtures/audience.js` | The frozen attack, the clean branch, the three audience payloads |
| `COORDINATION.md` | The three-lane build contract, written first and kept live |

---

## Honest limitations

We would rather say these than have them found.

- **The scripted demo's oracle is a fixture; the fact-checker's is not.** `LEDGER` in `fixtures/scenario.js` is a constant, and that is deliberate — the filmed run is measured against a known chain. But `src/factcheck.js` adjudicates against a **query**: active beliefs from sources at or above trust 0.9, joined to `sources` so every citation names the channel and carries the document `_id` you can open in Compass. The oracle grows as the database does. What is still true: swapping `LEDGER` for a live HTTP call in `src/verify.js` is one function.
- **The filmed demo runs no LLM.** Extraction runs on deterministic rules and embeddings on a lexical embedder, and every run prints which rung it used. `src/factcheck.js` *does* adjudicate a claim through a live model and is tested working — but it is **not wired into `npm run demo`**, so what you see filmed is the deterministic path end to end. See the note below.
- **Fact-checking works but is not yet in the attack path.** `factCheckAgainstMemory({ claim, subject_key })` reads the record set out of MongoDB, adjudicates, and returns a verdict, a correction, and the deciding source — named, with its trust score and its document `_id`. Verified against a live model on a free-text claim no fixture anticipates: it refuted an invented billing contact and cited `crm.acme.internal` at trust 0.92. What is *not* done is calling it from the live surface's attack flow, so it is a working component rather than something the demo shows you.
- **Derivation in the scripted demo is fixture-driven.** The three conclusions are frozen text so the cascade is measured against a known chain. The provenance edges, the traversal, the revocation and the reversal are all real writes and real queries.
- **Re-derivation is not built.** Immune diagnoses and undoes; it does not rebuild the correct conclusions afterwards. That is the right v2 and it did not fit in three and a half hours.
- **Trust is per-source, not per-source-per-subject.** A source that lies about refunds loses credibility about shipping too. Correct for the demo, too blunt for production.
- **The hosted surface polls; the local one streams.** A serverless invocation cannot hold an oplog cursor. Change streams are the real mechanism and `npm run watch` is where that proof lives.

---

## The questions you are going to ask

<details>
<summary><b>Isn't this just input validation?</b></summary><br>

Validation happens at the door, on data you already suspect. This handles the case where the lie is already in, already believed, and already reasoned from — the only interesting case, and the one every agent memory system currently ignores. The research is explicit that front-door defences do not stop memory poisoning, because it only has to succeed once.
</details>

<details>
<summary><b>How do you know which source to trust?</b></summary><br>

We don't, absolutely. Trust is reputational and moves on evidence: multiplicative decay on refutation, slow additive recovery on survived checks. Nothing is declared trustworthy by hand, and a new source starts at 0.70 — *above* the floor, because that is the honest model of how this actually fails.
</details>

<details>
<summary><b>You can't verify every fact.</b></summary><br>

Correct, and we don't. Verification fires on load-bearing beliefs only: about to drive a side-effectful action, two or more children, or contradicting an existing trusted belief. We don't check everything — we check what's about to matter.
</details>

<details>
<summary><b>Isn't this just an audit log?</b></summary><br>

A log records what happened. This records what was *believed*, why, and what followed from it — and then acts on that structure. Logs are read by humans afterwards; this is read by the agent before every action.
</details>

<details>
<summary><b>Why not a vector DB plus a graph DB?</b></summary><br>

Because the trust filter has to run *inside* the vector search. Pre-filtering on `source_trust` is only possible if trust lives on the documents being searched — split the stores and you retrieve semantically, then filter in application code, starving an already-truncated result set. And the provenance edges would live where the vector filter cannot see them. See [Why MongoDB](#why-mongodb).
</details>

<details>
<summary><b>What did you build today?</b></summary><br>

All of it, and we can name it file by file — see the table above, [CHANGELOG.md](CHANGELOG.md), the commit history, and the gate tags `p0-green`, `p3-green`, `tier3-green`. The repository was empty at 1:30 PM PT.
</details>

---

## Prior art this is answering

OWASP lists memory poisoning as **ASI06** in the Top 10 for Agentic Applications, and as **T1** in its agentic threat taxonomy. The attacks are named and reproducible — **MINJA** (>95% success), **AgentPoison**, and the **MPBench** benchmark — and the research is blunt that standard prompt-injection defences do not stop it.

Nobody is building the clean-up. **That is the half this is.**

---

<div align="center">

Three people, three lanes, one afternoon.
The build contract is [COORDINATION.md](COORDINATION.md) — written before any code and kept live as gates went green.

Licensed MIT. All fixtures, payloads and data in this repository were written by us for this event.

<br>

**OWASP calls this ASI06. We built the half nobody else is building: the clean-up.**

</div>
