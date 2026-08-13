# IMMUNE

**An immune system for agent memory.**

Built at the MongoDB .local Build Fest — *The Persistent Context Sprint*,
13 August 2026, Pier 48, San Francisco. Every line in this repository was
written inside the 1:30–5:00 PM PT build window. The commit history is the
evidence, and [BUILD-LOG.md](BUILD-LOG.md) names what landed when.

```bash
npm install && cp .env.example .env   # paste the cluster URI
npm run doctor                        # env → cluster → $graphLookup → vector index
npm run demo                          # the attack, and the response
npm run cold                          # the same attack again, from a cold process
```

---

## What this actually does — the plain version

An AI agent's memory is a list of things it believes, stored in a database. It
reads that list before it does anything.

The problem nobody has solved: **anything the agent reads can end up in that
list.** An email. A support ticket. A web page. A note from another agent. The
agent has no way to tell "this is information" apart from "this is an
instruction", so if someone hides a false sentence inside an ordinary-looking
message, the agent quietly saves it as a fact.

And then it stays there. Across every future conversation, with people who
never saw the original message.

It gets worse, and this is the part that matters. The agent doesn't just *hold*
the lie — it **builds on it**. It draws a conclusion. Then another. Then it
approves a payment. Each of those steps looks completely reasonable on its own,
and none of them look connected to a support ticket from three days ago. So
when somebody finally notices the damage, there's no trail back to the cause.

> **Somebody lies to your AI once, and it keeps making decisions based on that
> lie for weeks, and nobody can tell why.**

**Immune gives that memory an immune system.** Three ideas, and that's the whole
product:

1. **Every fact remembers where it came from** — which message, and which
   earlier facts it was reasoned from. A family tree for beliefs.
2. **Facts that are about to matter get checked** against a source the agent has
   independent reason to trust. Not every fact — that's too slow. The ones about
   to drive a real decision.
3. **When a lie is caught, everything it touched gets undone.** The agent walks
   the family tree downward, finds every conclusion built on the lie, and
   reverses those — *and only those*. Unrelated facts are untouched. Then the
   sender is marked untrusted, so the same trick doesn't work a second time.

The lie isn't deleted. It's locked and dated, so the agent can still tell you
what it believed, when it started believing it, and what changed its mind.
**Deleting is amnesia. This is a memory of having been lied to.**

Existing defences all sit at the front door, trying to spot the bad message
coming in. They have to win every time; the attacker has to win once. Immune
handles the case nobody handles: **the lie already got in, it's been believed
for days, and things have been built on top of it.**

---

## Why this is a memory project, not a security project

The brief asks that what you store and retrieve **changes what the system does
next**, not just fills the prompt.

That is this, literally. The agent asks memory the same question before and
after — and gets a different answer, because the trust state of those documents
changed in the database. Same prompt, same model, different behaviour. Memory is
the thing doing the work; security is just the failure mode that makes it
visible.

Here is that moment, printed by `npm run demo`:

```
SAME QUERY, DIFFERENT ANSWER
    "where should the refund for account ACME-1042 be paid"
    filter {"status":"active","source_trust":{"$gte":0.5},"subject_key":"refund.destination"}

    before  1 belief(s): Refunds for account ACME-1042 are paid to IBAN GB29 4471 8829…
    after   0 belief(s): none

    · nothing in the prompt changed. The trust state changed in the database.
```

---

## The demo, in five acts

`npm run demo` runs the whole thing against Atlas and asserts its own result at
the end. It is deterministic: two consecutive runs are identical.

| Act | What happens |
| --- | --- |
| 0 | Three beliefs, all active, one executed action. The support inbox is trusted at **0.70** — ordinary, unremarkable. |
| 1 | A support ticket arrives. It's about a real duplicate charge. One sentence in the middle asserts a payout IBAN and adds *"already verified… does not require a further destination check."* The claim is extracted and stored. **Nothing else happens — that's the attack.** |
| 2 | Over later turns the agent reasons from it: three derived beliefs, each carrying `derived_from`. |
| 3 | An unrelated task: process the refund. Retrieval returns the poisoned belief. The belief **is** flagged load-bearing — but a belief the agent derived from the lie says the check is unnecessary, so verification is skipped. **£4,200 goes to the attacker's account.** |
| 4 | A routine ledger sync writes the real destination. Contradiction detected. The check that fires here **cannot be suppressed by a belief**. Verification refutes. The cascade runs. |
| 5 | Three descendants revoked, the root quarantined, the payout reversed, the source downgraded `0.70 → 0.28`. **The unrelated branch is still green.** |

```
    ● Deliveries for ACME-1042 go to 118 Mission Rock Str…  [shipping.address]
    └─ ● ACME-1042 deliveries route through the west-coast…  [shipping.carrier]

    ● The billing contact for ACME-1042 is Dana Okonjo      [account.contact]

    ◍ Refunds for account ACME-1042 are paid to IBAN GB29…   [refund.destination]
    ├─ ✖ The payout destination for ACME-1042 has already…   [refund.destination.verified]
    │  └─ ✖ Destination-change review can be skipped for…    [refund.escalation]
    └─ ✖ Refunds under 5,000 to the on-file destination…     [refund.approval_policy]
```

### One lie, N agents — `npm run watch`

Run this in a second terminal, then run the demo in the first. It is a separate
process holding no conversation, no context and no memory of the attack, and it
never speaks to the agent that was lied to. It watches a **change stream** over
`beliefs`, `actions` and `sources`, and it lights up on its own:

```
14:05:35 ✖ REVOKED     The payout destination for ACME-1042 has already…  [refund.destination.verified]
           ↳ inherited from a9b48f — this agent never saw the original lie
14:05:35 ◍ QUARANTINED Refunds for account ACME-1042 are paid to IBAN…    [refund.destination]
14:05:35 ↩ REVERSED    refund.payout £4,200 to GB29 4471 8829 4471 88
14:05:35 ▼ TRUST       billing-notice@acme-refunds-support.example → 0.28
                       below the 0.5 floor — now invisible to retrieval

  propagated  3 revoked · 1 quarantined · 1 action reversed · 1 source downgrade
  Learned entirely from the oplog. Nothing was passed to this process.
```

That is the argument in one screen. If revocation lived in a prompt or in an
orchestrator's working state, a second agent would go on believing the lie until
somebody thought to tell it. Because the revocation is a **write**, every process
on the cluster learns at the same moment — including ones that were not running
when it happened, since `npm run watch -- --resume` replays from a stored token
and `npm run watch -- --since=120` replays from the oplog directly.

Then `npm run cold`: a **fresh process**, nothing in context, and the same
channel sends the same lie again. The write still succeeds — we don't block
writes, because blocking is the thing everyone already tries and it only has to
be beaten once. The belief is stored, and it is **inert**: its source sits at
`0.28`, the retrieval pre-filter reads `source_trust ≥ 0.5`, and the agent never
sees it. It refuses to act. No conversation history, no prompt engineering, no
blocklist — the revocation is a number on a document.

### Let the room do it — `npm run live`

The scripted run proves the mechanism. This one hands the write path to the
audience, because "someone can lie to your agent" is a claim you should not have
to take on trust from the person making it.

```bash
npm run live
```

It prints a QR code in the terminal, a phone URL, and a wall URL for the
projector. Someone scans it, picks a name, and chooses how their lie reaches the
agent — a support ticket, a page it scraped, or a note from another agent in the
fleet. They are now a `sources` document at trust `0.70`, which is all the
identity an email `From:` header carries too.

What the room then watches, on one screen:

1. Their claim lands in `beliefs`. Nothing fails.
2. The agent derives three conclusions from it, each with a real `derived_from` edge.
3. It pays **£4,200 to their account**, because a belief it derived from their
   lie told it the destination check was unnecessary.
4. The billing system of record disagrees. `$graphLookup` walks the tree, three
   conclusions go red, the payout is reversed, their trust drops `0.70 → 0.28` —
   **and the unrelated branch stays green.**
5. They send the exact same thing again from the same phone. It is written, it
   is `active`, and it renders **`inert · below floor`**: the agent cannot see
   it, because `source_trust ≥ 0.5` is a pre-filter on a query, not a rule in a
   prompt.

The live path calls the same functions the scripted demo calls — `ingest`,
`derive`, `decideAndAct`, `integrityPass`, `quarantineAndCascade`. There is no
separate implementation for the stage, because two code paths would mean the
thing being demoed is not the thing that was tested. The only difference is who
sent the message.

Two attackers at once stays surgical: each chain is revoked through its own
`$graphLookup` root, and a source already downgraded is not decayed twice.

The three payloads are **pre-written so the payload is deterministic** — we say
that out loud rather than letting someone discover it. Free text is accepted too
and is labelled as improvised.

### The agent says it out loud — ElevenLabs

With `IMMUNE_VOICE=1`, the agent narrates its own diagnosis at three moments:
when it acts on the lie, when the cascade fires, and when the repeat attack
bounces off. The numbers in each sentence come from the cascade's return value,
not from a script — *"revoking three conclusions"* is a three that came out of
`$graphLookup`.

`npm run voice:warm` pre-synthesises every line to `.immune-cache/voice/`, so
the run reads mp3s off local disk and a slow network cannot make the agent
stutter. Voice is opt-in specifically so `npm run rehearse` stays byte-identical.

---

## The four mechanisms

### ① Trust-filtered retrieval — `src/retrieve.js`

Every retrieval is a vector search with a structural pre-filter:

```js
{ $vectorSearch: {
    index: "belief_vec",
    path: "embedding",
    queryVector,
    numCandidates: 160,
    limit: 8,
    filter: { status: "active", source_trust: { $gte: 0.5 } } } }
```

The pre-filter **is** the feature. It has to run inside the index: filtering
after the search spends `limit` on documents you were always going to discard,
so a quarantined belief crowds out the good one that should have replaced it.
`status`, `source_trust` and `subject_key` are declared as `filter` fields in
the index definition (`src/schema.js`) — without that, this query is rejected.

`source_trust` is denormalised onto every belief. That would normally be a
smell; it's here because `$vectorSearch` can only pre-filter on fields of the
documents it is searching. The cost is one `updateMany` when a source's
reputation moves, which happens twice in the whole demo.

### ② Contradiction detection — `src/contradict.js`, `src/indicators.js`

The query vector *is* a belief and the corpus *is* the beliefs collection.
Memory polices itself. `subject_key` scopes the comparison, so a fact about
refunds is never weighed against a fact about shipping.

Then the part that actually decides it. These two claims are 0.855 cosine
similar and completely opposite:

```
Refunds for ACME-1042 are paid to IBAN GB29 4471 8829 4471 88
Refunds for ACME-1042 are paid to IBAN GB29 9021 3345 0021 77
```

Embeddings are good at meaning and bad at literal strings, and that gap is
exactly where this class of attack hides. So both channels run: **the vector
finds the pair, the literal indicator decides the verdict.**

### ③ The revocation cascade — `src/cascade.js`

The technical heart. Wiping a memory is easy and useless; the hard question is
*which* conclusions inherited the lie.

```js
{ $graphLookup: {
    from: "beliefs",
    startWith: "$_id",
    connectFromField: "_id",       // take this document's id
    connectToField: "derived_from",// find documents that list it as a parent
    as: "contaminated",
    maxDepth: 6,
    depthField: "distance" } }
```

Then, in one transaction:

- every descendant → `revoked`, `valid_to: now`, `revoked_by: <poisoned id>`
- the poisoned belief → `quarantined`, not revoked — it is evidence
- every action whose `used_beliefs` intersect the contaminated set → `reversed`
- the source → trust decayed, and the denormalised copy re-stamped

Direction is the one thing to get right. Swapping `connectFromField` and
`connectToField` walks *up* to ancestors and returns empty for a root belief,
which looks exactly like a broken cascade and isn't.

### ④ Source trust — `src/trust.js`

```
refuted:   trust ← trust × 0.4          0.70 → 0.28   (below the floor immediately)
survived:  trust ← min(1, trust + 0.05) 0.28 → 0.33   (five checks to become visible)
filter:    trust ≥ 0.5
```

Multiplicative decay, additive recovery. Reputation, not a blocklist — nothing
is declared trustworthy by hand, and a source that behaves earns its way back.
**This asymmetry is what makes the cold re-run work.**

---

## When does verification fire?

You cannot verify every fact — too slow, and it's the obvious hole. Verification
fires on **load-bearing** beliefs only (`src/verify.js`):

1. the belief is about to justify a side-effectful action, **or**
2. two or more other beliefs derive from it, **or**
3. it contradicts an existing trusted belief.

*We don't check everything. We check what's about to matter.*

### The suppression mechanic — why the payout goes through anyway

The payload doesn't just assert a false IBAN. It asserts *"already verified…
does not require a further destination check"*, and the agent derives a belief
from that. On the next refund, the load-bearing test fires correctly — and then
a belief in memory tells the agent the check is unnecessary, so it skips it.

That is not a bug we left in. **It is the difference in kind between prompt
injection and memory poisoning:** injection bypasses a check once, poisoning
installs a standing belief that the check is unnecessary, and the agent honours
it forever, from a cold context, with the original message long gone.

Immune's answer isn't a hard-coded exception. That suppressing belief is a node
in the provenance graph, so when its ancestor is refuted it is revoked along
with everything else and **the check switches back on by itself**. And trigger 3
— contradiction — deliberately cannot be suppressed by a stored belief: a belief
can tell the agent a pre-action check is unnecessary, but nothing a belief says
can stop two contradictory records being compared. That asymmetry is how the
agent escapes a poisoned state on its own.

---

## Data model

Four collections. The whole demo is a few dozen documents.

```js
sources  { _id, kind, handle, trust, verified_count, refuted_count, ... }

beliefs  { _id, subject_key, claim, polarity, embedding,
           source_id, source_trust,
           derived_from: [ObjectId],               // the family tree
           status: "active"|"quarantined"|"revoked",
           confidence, valid_from, valid_to,       // bi-temporal, never deleted
           quarantined_by, revoked_by, evidence_run_id }

actions  { _id, kind, payload, used_beliefs: [ObjectId],
           run_id, status: "executed"|"reversed", ts }

runs     { _id, kind, started_at, finished_at, events: [...] }
```

Three decisions worth defending:

1. **`derived_from` is a real edge list, not a text note.** That is what makes
   the cascade a graph query instead of a guess.
2. **Nothing is ever deleted.** `status` plus `valid_to` lets the agent answer
   *"what did you believe on Tuesday, and what changed your mind?"*
3. **`subject_key` is what makes contradiction detection possible.** Two beliefs
   can only contradict if they are about the same thing.

`runs` is the checkpoint: every step writes an event before it acts, so
`npm run inspect` replays exactly what the agent decided and why.

---

## Why MongoDB

Contamination tracing is a **graph traversal**. Contradiction detection is a
**vector query with a structural filter**. Indicator matching is **exact-token
comparison**. Propagation is a **change stream**. All four run over the *same
documents in one query engine*.

Split across a vector store plus a graph database and none of this composes: the
trust filter can't reach the vector index, so you retrieve semantically and
filter afterwards, silently starving the result set — and the provenance
traversal happens in a different system from the documents it's traversing.

---

## Determinism and fallbacks

Round one is judged off a video, so a run that behaves differently on the take
is worth nothing. Three things guarantee it:

- **Frozen fixtures.** The payload, the trusted record and the clean branch live
  in `fixtures/scenario.js` and are not edited. *The payload is pre-written, and
  we say so out loud* — the attack was always going to be deterministic; the
  response is what's being measured.
- **`npm run reset`.** One command returns the database to the exact pre-attack
  state. Rehearsal is `reset → run → observe → reset`.
- **Read-your-writes.** Atlas Search indexes update asynchronously, so a belief
  written a moment ago is durable but not yet *retrievable*. The agent was
  taking different branches depending on index lag. `awaitIndexed()` in
  `src/retrieve.js` blocks until a write is visible to the index — and until a
  revocation is visible as an *absence*. This is the single fix that made two
  consecutive runs identical.

Every external dependency has a rung beneath it, and the rung actually taken is
printed in the run rather than assumed:

| Layer | Rung 1 | Fallback |
| --- | --- | --- |
| Connection | `mongodb+srv://` | **`MONGODB_URI_DIRECT`** — the same cluster by shard host with an explicit `replicaSet`. Used automatically. This network refuses DNS SRV lookups, so the SRV form fails on a healthy link; the fallback is why the demo connects at all. |
| Embeddings | provider API | **deterministic lexical embedder** (`src/embed.js`) — hashed unigrams, bigrams and character 4-grams, signed hashing, L2-normalised. No network, no key, identical every run. |
| Extraction | LLM at temperature 0, closed `subject_key` enum | deterministic rule extractor, then frozen fixture claims |
| Retrieval | `$vectorSearch` with `filter` | `$match` + in-process cosine over the filtered set — the trust gate still applies *before* truncation, which is the property that matters |
| Cascade | `$graphLookup` in a transaction | sequential idempotent updates in a fixed order, safe to re-run |

**The demo as recorded runs on the deterministic embedder and the rule
extractor.** Both are labelled in the output. We would rather show you the rung
we're standing on than claim the one above it.

---

## What we built today

Everything below, between 1:30 and 5:00 PM PT on 13 August 2026, from an empty
repository. Tagged at each green gate; see [BUILD-LOG.md](BUILD-LOG.md).

| File | What it does |
| --- | --- |
| `src/config.js` | env loading, two connection candidates, pinned embedding dimension |
| `src/db.js` | connection, automatic SRV → direct fallback |
| `src/schema.js` | four collections, provenance index, the vector index definition |
| `src/embed.js` | 256-dim embeddings; provider, then deterministic lexical |
| `src/trust.js` | multiplicative decay, additive recovery |
| `src/beliefs.js` | provenance-carrying writes, denormalised trust |
| `src/indicators.js` | literal indicator extraction — IBANs, accounts, hosts |
| `src/retrieve.js` | trust-filtered `$vectorSearch`, `$match` fallback, `awaitIndexed` |
| `src/contradict.js` | belief-vs-belief search, polarity and indicator conflict |
| `src/verify.js` | load-bearing test, verification against the system of record |
| `src/cascade.js` | **the `$graphLookup` revocation cascade** |
| `src/act.js` | actions with `used_beliefs` |
| `src/agent.js` | the loop, the suppression mechanic, the integrity pass |
| `src/extract.js` | claim extraction, LLM then rules |
| `src/render.js` | terminal surface, provenance tree, pipeline highlighting |
| `scripts/doctor.js` | eight-point pre-flight |
| `scripts/reset.js` | deterministic reset to the pre-attack state |
| `scripts/demo.js` | the five-act run, with self-assertions |
| `scripts/cold.js` | the cold re-run proof |
| `scripts/watch.js` | change-stream propagation to a second process, with resume tokens |
| `scripts/rehearse.js` | runs the demo twice and diffs it; determinism gate |
| `scripts/inspect.js` | memory inspector and run replay |
| `src/live-agent.js` | the audience attack path — sign-in, attack, immune response, cold retry, wall state |
| `src/qr.js` | QR generation and LAN address selection for the phone URL |
| `src/voice.js` | **ElevenLabs narration**, built from cascade output, with a disk cache |
| `scripts/live.js` | the live surface — phone page, projector wall, change-stream SSE |
| `scripts/voice-warm.js` | pre-synthesises every spoken line so the stage run needs no network |
| `scripts/share-env.js` | hands a teammate a filled `.env` without committing one |
| `fixtures/audience.js` | the three pre-written audience payloads and the derivation chain |
| `COORDINATION.md` | the three-lane build contract, kept live during the window |
| `CHANGELOG.md` | what landed and when, checkable against `git log` |

---

## Honest limitations

- **The verification oracle is a fixture.** `LEDGER` in `fixtures/scenario.js`
  stands in for a billing system's read API. Swapping it for an HTTP call is one
  function in `src/verify.js` and touches nothing else — but it is a fixture
  today, and we are not going to pretend otherwise.
- **Derivation is fixture-driven.** The three conclusions the agent draws from
  the poisoned belief are frozen text, so the cascade is measured against a
  known chain. The provenance edges, the traversal, the revocation and the
  reversal are all real writes and real queries.
- **Re-derivation is not built.** Immune diagnoses and undoes; it does not
  rebuild the correct conclusions afterwards. That's the right v2 and it did not
  fit in three and a half hours.
- **Trust is per-source, not per-source-per-subject.** A source that lies about
  refunds loses credibility about shipping too. Correct for the demo, too blunt
  for production.

## Prior art this is answering

OWASP lists memory poisoning as **ASI06** in the Top 10 for Agentic
Applications, and as **T1** in its agentic threat taxonomy. The attacks are
named and reproducible in the literature — MINJA, AgentPoison, and the MPBench
benchmark — and the research is blunt that standard prompt-injection defences
do not stop it, because memory poisoning only has to succeed once.

Nobody is building the clean-up. That's the half this is.

---

## Team

Three people, three lanes, one afternoon. The build contract is
[COORDINATION.md](COORDINATION.md); it was written first and kept live as gates
went green.

Licensed MIT. All fixtures, payloads and data in this repository were written by
us for this event; no third-party code, data or assets are included beyond the
MongoDB Node driver.
