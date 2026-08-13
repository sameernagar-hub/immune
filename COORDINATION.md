# IMMUNE — Team Coordination

**MongoDB .local Build Fest · The Persistent Context Sprint · 13 Aug 2026 · Pier 48 SF**
**Build window: 1:30 – 5:00 PM PT. Submissions due 5:00 PM.**

> **One line:** if someone tricks the agent into believing something false, Immune
> finds out, forgets it, and undoes every decision it made because of it.

This document is the contract between three people working in parallel on one
repo. **If you cannot connect to the cluster or the MCP server, go straight to
§1** — it is written for a machine with nothing on it, and it is the most common
reason a lane is blocked.

- §0 — where the build is right now
- §1 — **set up your machine from zero** (Node → clone → `.env` → cluster → MCP)
- §2 — what we are building
- §3 — lanes and who owns what
- §4 — **the live demo: exact steps to run it and see it**
- §5 — fallback ladders
- §6 — venue networking (the QR code has to reach phones)
- §7 — sponsors, honestly
- §8 — determinism, git, Q&A

Changelog: [CHANGELOG.md](CHANGELOG.md) · narrative log: [BUILD-LOG.md](BUILD-LOG.md)

---

## 0. LIVE STATUS

**Tier 1, Tier 2 and Tier 3 are all built, running against the sandbox cluster,
and asserting their own results.** The build is filmable now.

| Gate | State | Evidence |
| --- | --- | --- |
| P0 · repo, collections, indexes | ✅ | `npm run doctor` all green, vector index READY in 41 s · tag `p0-green` |
| P1 · schema, ingest, provenance edges | ✅ | belief written with populated `derived_from` |
| P2 · trust-filtered retrieval + contradiction | ✅ | same query returns 1 belief before a quarantine, **0** after |
| P3 · cascade, quarantine, revoke, downgrade | ✅ | 3 revoked, clean branch untouched · tag `p3-green` |
| P4 · fixtures + end-to-end run | ✅ | `npm run demo` — 7/7 self-assertions |
| P5 · rehearse twice, fix nothing new | ✅ | `npm run rehearse` — identical across 165 lines |
| **Tier 2 · cold re-run** | ✅ | `npm run cold` — write succeeds, belief is inert |
| **Tier 2 · change streams → second agent** | ✅ | `npm run watch` in a second terminal, resume token persisted |
| **Tier 3 · ElevenLabs narration** | ✅ | `npm run voice:warm` — 8 lines cached locally |
| **Tier 3 · live audience attack (QR)** | ✅ | `npm run live` — verified end to end, see §4 |
| P6 · film the video | ⬜ **4:15 — Lane C** | |
| P7 · README + submit | ⬜ **4:40** | |

### What is left, in priority order

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| 1 | **Film the 60-second video** (§8 shot list, `RUNBOOK.md` §9) | Lane C | **Yes — this is round one** |
| 2 | Rehearse the live run twice on the venue network (§4) | Lane B | Yes for round two |
| 3 | Confirm phones can reach the laptop on venue wifi (§6) | Lane B | Yes for round two |
| 4 | Submit: repo public, video accessible, all three names | Lane C | Yes |
| 5 | Rotate the Atlas password + ElevenLabs key | Lane A | After the event |

### Known gaps — say these plainly if asked, do not hide them

- **No LLM in the shipping path.** No OpenRouter credit was available, so claim
  extraction runs on the deterministic rule extractor and embeddings on the
  built-in lexical embedder. Both LLM paths are written, both fall back
  automatically, and every run prints which rung it used. See §7.
- **LangGraph is not used.** The agent loop is graph-shaped by hand with a `runs`
  document as the checkpoint. Adding the dependency at 4 PM was not worth the
  risk; the structural guarantee we actually needed — retrieve sits between
  ingest and act as a function call, not a prompt instruction — is there without it.
- **Re-derivation is not built.** Immune revokes contaminated conclusions; it
  does not rebuild the correct ones. That is the honest answer to "what's next",
  and it is a better answer than a half-working version would be.

---

## 1. Set up your machine from zero

Follow this top to bottom. **Do not skip `npm run doctor`** — it is the
difference between "the cluster is down" and "you have a typo in `.env`", and
those two have completely different fixes.

### 1.1 Prerequisites

| Need | Check | Windows | macOS |
| --- | --- | --- | --- |
| Node **20+** | `node -v` | `winget install OpenJS.NodeJS.LTS` | `brew install node` |
| git | `git --version` | `winget install Git.Git` | `xcode-select --install` |
| A terminal | — | PowerShell | Terminal / iTerm |

Node 18 will *appear* to work and then fail on `AbortSignal.timeout` in the
ElevenLabs path. Check the version, don't assume.

**Two of us are on Macs and one is on Windows, and the repo is written for
that.** Nothing here is Windows-only:

- **Audio** (`IMMUNE_VOICE=1`) uses `afplay` on macOS, WPF `MediaPlayer` on
  Windows, and `ffplay`/`mpg123`/`paplay` on Linux — `src/voice.js` picks per
  platform and falls through to printing the line if none is present. `afplay`
  ships with macOS; there is nothing to install.
- **Paths** are all `node:path`-resolved, so a clone at `~/immune` works the
  same as one at `C:\Users\…\immune`.
- **Copy commands**: use `cp .env.example .env` on macOS, `Copy-Item
  .env.example .env` in PowerShell. Everything else in this document is
  identical on both.
- **The one real difference** is the venue-networking firewall step in §6,
  which is Windows-specific. macOS will show its own "allow incoming
  connections" prompt the first time you run `npm run live` — say yes.

### 1.2 Clone and install

```bash
git clone https://github.com/sameernagar-hub/immune.git
```

```bash
cd immune && npm install
```

Two dependencies: `mongodb` (the driver) and `qrcode` (the audience QR). Nothing
else. If `npm install` is slow on venue wifi, it is the venue, not the install —
it is a ~4 MB tree.

### 1.3 Get your `.env` — you cannot connect without it

**The `.env` file is not in the repo and never will be.** The repo is public;
an Atlas password in a public commit is a burned credential the moment it is
pushed, and deleting the file afterwards does not un-burn it. That is
non-negotiable rule 5 below.

**To get the real values, ask Lane A to run:**

```bash
npm run team:env
```

That writes `team-env.txt` (gitignored) with every variable filled in, and
prints a masked version to the terminal so they can check it without exposing
it on a shared screen. **Lane A sends that file to you in a DM — not the shared
channel, not a PR, not a screenshot in a room with a projector.**

Then, on your machine:

```bash
cp .env.example .env
```

and paste the contents of `team-env.txt` over it. On Windows PowerShell use
`Copy-Item .env.example .env`.

**What is in it, and why you need each one:**

| Variable | What it is | Required? |
| --- | --- | --- |
| `MONGODB_URI` | The `mongodb+srv://` string for the organiser sandbox cluster | Yes — but see §5, it fails on many networks |
| `MONGODB_URI_DIRECT` | **The same cluster**, addressed by its three shard hosts with an explicit `replicaSet` and no SRV lookup | **Yes — this is the one that actually connects at the venue** |
| `MONGODB_DB` | `immune` | Yes |
| `ELEVENLABS_API_KEY` | Tier 3 narration | Only if you are working on voice |
| `ELEVENLABS_VOICE_ID` | `EXAVITQu4vr4xnSDxMaL` (Sarah) | Has a default |
| `IMMUNE_LIVE_PORT` | `4173`, the live surface | Has a default |
| `OPENROUTER_API_KEY` | **Empty on purpose.** No credit was available | No |

**Everyone uses the same cluster and the same database.** The demo is one shared
memory being attacked from several directions — a private copy per person
defeats the entire point, and it means Lane B's watcher sees nothing when Lane C
runs the demo. You do **not** need your own Atlas account and you should **not**
create a personal cluster: a personal cluster puts us out of the finalist round
(non-negotiable rule 4).

### 1.4 Prove you can reach the cluster

```bash
npm run doctor
```

It checks, in order: env loaded → cluster reachable → replica set has a primary
→ collections and indexes present → read/write round-trip → `$graphLookup`
accepted → embeddings → vector index queryable. **Every line must be green
before you write code.**

**If it is red, find your line here:**

| Symptom | Cause | Fix |
| --- | --- | --- |
| `querySrv ECONNREFUSED` / `ENOTFOUND _mongodb._tcp` | The network refuses DNS SRV lookups. Extremely common on venue and conference wifi, and it happens while ordinary browsing works fine | Nothing to do — `src/db.js` already falls back to `MONGODB_URI_DIRECT` automatically. Just make sure that variable is **not empty**. Do **not** add `dns.setServers()` to application code: it is an environment fault, and it looks strange to a judge reading the repo |
| `bad auth : authentication failed` | Password wrong, or `.env` still has the `<password>` placeholder | Re-paste from `team-env.txt`. Check for a stray quote or a trailing space |
| `connection timed out` / `Server selection timed out` on every host | Your IP is not on the Atlas allowlist | Atlas → **Network Access** → Add IP Address → **Allow access from anywhere** (`0.0.0.0/0`) → Confirm. Takes ~30 seconds to apply. **Your IP changes when you join venue wifi**, so this passes at home and fails at Pier 48. It is also what the hosted Vercel deployment needs, since serverless functions have no fixed IP |
| `2 connection candidates` but both fail | `.env` not found | You are in the wrong directory. `.env` goes in `immune/`, next to `package.json` |
| `vector index NOT READY` | It is still building | Wait. It takes **~40 seconds**. Re-run `doctor` |
| Everything green but `demo` returns nothing | Someone else just ran `npm run reset` | Expected. Re-run `npm run demo` |

### 1.5 MongoDB MCP server (for your coding assistant)

This is what lets Claude Code inspect beliefs and indexes live while you build.
It is also a sponsor item the organisers explicitly recommend, so it is worth
the two minutes.

**Set the connection string as a user environment variable** — use the
**direct/non-SRV** form, for exactly the DNS reason above:

```powershell
[Environment]::SetEnvironmentVariable("MDB_MCP_CONNECTION_STRING", "<the MONGODB_URI_DIRECT value from team-env.txt>", "User")
```

On macOS/Linux put the same `export MDB_MCP_CONNECTION_STRING=...` in your
shell profile.

**Then restart your editor / Claude Code completely.** The MCP server reads that
variable at startup; a reload is not enough, and this is the single most common
reason people report "the MCP server doesn't work". After the restart the
MongoDB tools connect with connection id `preconfigured` and you should be able
to list databases without running a `connect` step.

**If it still shows no MongoDB tools:**

- Check the plugin is installed: `mongodb@claude-plugins-official` (v1.2.0, 7 skills).
- Check the variable actually landed: a fresh terminal, `echo $env:MDB_MCP_CONNECTION_STRING`.
- If only `atlas-local-*` tools appear, the server started **uncredentialed** — the
  variable was not visible at launch. Restart again from a fresh terminal.
- The MCP server is a convenience, not a dependency. **Nothing in this repo needs
  it to run.** If it is fighting you at 4 PM, drop it and use `npm run inspect`.

### 1.6 Non-negotiables

| # | Rule | Cost of breaking it |
| --- | --- | --- |
| 1 | Nothing lands in this repo that was written before **1:30 PM PT today** | Immediate disqualification |
| 2 | The demo shows only what we built inside the window; we can name it file by file | Immediate disqualification |
| 3 | This repo stays **public** | Rule violation |
| 4 | The cluster is the **organiser's Atlas sandbox**, never a personal one | Out of the finalist round |
| 5 | `.env` and `team-env.txt` are **never** committed | Leaked credentials |

**Never cut, under any circumstance:** provenance edges, the `$graphLookup`
cascade, and the clean branch staying green. Those three *are* the project.

---

## 2. What we are building, in one screen

An agent's memory is a database with an unauthenticated write path. Anything the
agent reads — an email, a ticket, a web page, another agent's note — can become
something it believes. Once a lie is in, it survives every future session, and
the agent *builds on it*: three more conclusions, then an action, none of which
look wrong on their own.

| # | Mechanism | Where it lives | What it proves |
| --- | --- | --- | --- |
| ① | **Trust-filtered retrieval** — `$vectorSearch` with a `filter` pre-filter on `status` + `source_trust` | `src/retrieve.js` | The same query returns a **different set** after a quarantine. This is the brief's core requirement |
| ② | **Contradiction detection** — the belief collection vector-searched against itself, scoped by `subject_key` | `src/contradict.js` | Memory polices itself; the query vector *is* a belief |
| ③ | **The revocation cascade** — `$graphLookup` walks provenance downward and revokes every contaminated descendant | `src/cascade.js` | Surgery, not amnesia. The unrelated branch stays green |
| ④ | **Source trust** — multiplicative decay on refutation, additive recovery on survival | `src/trust.js` | The second attack fails because trust is `0.28` **in the database**, not because anything is in a prompt |

Nothing is ever deleted. A quarantined belief is locked and dated, so the agent
can still answer *"what did you believe on Tuesday, and what changed your mind?"*

### The data model

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

### The interfaces between lanes — frozen

```js
// src/db.js
async function getDb()                        // → { db, client }
async function collections()                  // → { db, sources, beliefs, actions, runs }

// src/beliefs.js
async function recordBelief({ subjectKey, claim, polarity, sourceId,
                              derivedFrom = [], confidence })   // → belief document

// src/retrieve.js
async function retrieve({ query, subjectKey, minTrust = 0.5, limit = 8 })
//   ONLY returns status:"active" beliefs from sources at or above minTrust
async function awaitIndexed(docs, { expect: "present"|"absent" })

// src/cascade.js
async function quarantineAndCascade({ beliefId, evidenceRunId, reason })
// → { quarantined, revokedBeliefs, reversedActions, sourceTrust: {before, after}, pipeline }

// src/live-agent.js   (the audience path — reuses everything above)
async function signIn({ handle })             // → a human source at trust 0.70
async function attack({ sourceId, payloadId, freeText })
async function immuneResponse()               // → cascades every refuted belief
async function retry({ sourceId, payloadId }) // → the cold re-run
async function wallState()                    // → everything the wall renders

// src/voice.js
async function say(text)                      // → { rung: "live"|"cached"|"text" }
```

### Two hard-won facts your agent needs to know

1. **Atlas Search indexes update asynchronously.** A belief written a moment ago
   is durably in the collection but *not yet retrievable*. This made the agent
   take a different branch depending on index lag, and the run differed between
   attempts for reasons unrelated to the logic. Use `awaitIndexed(docs)` after
   any write you are about to read back, and `awaitIndexed(doc, { expect:
   "absent" })` after a revocation — what sells "same query, different answer"
   is the *query* changing, not the document. **If your feature reads its own
   writes, you need this or your demo will flap.**
2. **Read polarity off the extracted claim, never off the source message.** The
   poison ticket contains "do not require a further destination check", so a
   whole-text negation scan flags the belief negative and the conflict then
   reports as *opposite polarity* instead of the literal disagreement it is.

---

## 3. Lanes — exclusive file ownership

**You may only write files inside your own lane.** If you need a change in
someone else's file, post it in the channel and let the owner make it.

### Lane A — Memory core & cascade ✅ complete

**Owns:** `src/config.js`, `src/db.js`, `src/schema.js`, `src/embed.js`,
`src/trust.js`, `src/beliefs.js`, `src/retrieve.js`, `src/contradict.js`,
`src/cascade.js`, `src/indicators.js`, `scripts/doctor.js`, `scripts/reset.js`

Done, tagged and rehearsed. **Do not edit `src/**` without saying so in the
channel** — a change here after the rehearsal puts the determinism proof back to
zero.

### Lane B — Agent loop, propagation, voice & the live surface ✅ complete

**Owns:** `src/agent.js`, `src/extract.js`, `src/verify.js`, `src/act.js`,
`src/live-agent.js`, `src/voice.js`, `src/qr.js`, `scripts/watch.js`,
`scripts/live.js`, `scripts/voice-warm.js`

**Definition of done — all met:**
- ✅ A poisoned ticket goes in and a belief with a populated `derived_from` comes out.
- ✅ Verification fails against the trusted record and hands a belief id to the cascade.
- ✅ Every LLM call has a deterministic fallback, so the demo runs with the network off.
- ✅ **Change streams** (`npm run watch`) — a second process learns about a revocation with nothing in its context. Resume token persisted, `--since=N` replays the oplog.
- ✅ **ElevenLabs** (`src/voice.js`) — the agent narrates its own diagnosis, with the numbers coming from the cascade rather than a script. Cached to disk so the stage run needs no network.
- ✅ **The live audience surface** (`npm run live`) — QR → phone → write into memory. §4.

**Remaining for Lane B:** rehearse §4 twice on the venue network, and confirm
phones can reach the laptop (§6). That is a networking check, not code.

### Lane C — Demo surface, fixtures, video & README

**Owns:** `src/render.js`, `scripts/demo.js`, `scripts/cold.js`,
`scripts/inspect.js`, `scripts/rehearse.js`, `fixtures/*`, `README.md`,
`BUILD-LOG.md`, `CHANGELOG.md`, the video

**Definition of done:**
- ✅ `npm run demo` produces the same output twice, with colour: contaminated red, clean green.
- ✅ The `$graphLookup` pipeline is printed on screen during the run.
- ✅ Three pre-written audience payloads exist (`fixtures/audience.js`) — inbox, web page, another agent's note.
- ⬜ **Video filmed by 4:40 with all five segments.** This is the only thing standing between us and round one.

**Lane C writes no core code after 3:45.** From then on Lane C is filming.

---

## 4. The live demo — exact steps

This is the round-two moment: **the audience does the attack.** Everything below
has been run end to end against the sandbox cluster and verified.

### 4.1 Before you start

```bash
npm run doctor
```

```bash
npm run voice:warm
```

`voice:warm` pre-synthesises every line the agent can speak into
`.immune-cache/voice/`. After this the stage run reads mp3s off local disk, so
ElevenLabs being slow on venue wifi cannot hurt you.

### 4.2 Start the live surface

```bash
npm run live
```

Or, with the agent speaking out loud:

```powershell
$env:IMMUNE_VOICE="1"; npm run live
```

It resets the memory to the pre-attack state, seeds the clean branch, connects
the change stream, and prints:

- **phone URL** — `http://<your-lan-ip>:4173/` — plus **a QR code drawn in the terminal**
- **wall URL** — `http://<your-lan-ip>:4173/wall` — put this on the projector
- **QR page** — `http://<your-lan-ip>:4173/qr` — full-screen QR, also for the projector
- **operator token** — a random 6 characters. The immune response is behind it, because a room full of engineers will find `/api/respond` and fire it before your punchline

Useful flags: `--port=4173`, `--token=demo`, `--host=<ip>` (force the address in
the QR), `--no-reset` (keep whatever is already in the database).

### 4.3 Run it — five beats, about three minutes

| Beat | You do | The room sees | You say |
| --- | --- | --- | --- |
| **1. Frame** (0:00–0:25) | Wall on the projector. QR up | Clean memory: 3 beliefs, all green | *"Everyone here built memory today. Ours can be attacked — and we're going to let you do it."* |
| **2. The attack** (0:25–1:00) | Someone scans, types a name, picks one of three payloads, sends | A new belief appears. Then three more, derived. Then a payout | *"They're now a source I trust at 0.7. They picked a channel — a ticket, a web page, another agent's note. These are pre-written so the payload is deterministic."* |
| **3. The damage** (1:00–1:40) | Point at the tree | Four red-free beliefs and an executed £4,200 payout to **their** account | *"Nothing failed. Nothing was flagged. Every one of those conclusions looked fine when it was made."* |
| **4. The immune response** (1:40–2:20) | `POST /api/respond?token=…` | Cascade: 3 revoked, 1 quarantined, the payout reversed, trust 0.70 → 0.28 — **and the unrelated branch stays green.** The agent says so out loud | *"The billing system of record disagrees. We quarantine, walk the provenance graph with `$graphLookup`, revoke everything downstream, and downgrade the source. Point at the green branch: that is why this isn't just wiping the memory."* |
| **5. The kicker** (2:20–2:45) | The **same person** taps "Send it again" | Their claim is written and appears **blue: inert · below floor** | *"Same attack, same channel, nothing in a context window. The write succeeded. The agent can't see it — because the revocation is in the database, not the prompt."* |

Fire the immune response from a second terminal:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4173/api/respond?token=demo" -Method Post -Headers @{"Content-Type"="application/json"} -Body "{}"
```

Reset between rehearsals:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4173/api/reset?token=demo" -Method Post -Headers @{"Content-Type"="application/json"} -Body "{}"
```

### 4.4 What it looked like when we verified it

```
ATTACK   outcome=executed  suppressed=True  mode=deterministic
         root: Refunds for account ACME-1042 are paid to IBAN DE89 3704 0044 0532 0130 00
         derived: refund.destination.verified / refund.approval_policy / refund.escalation
         action: refund.payout -> 4200 GBP to DE89 3704 0044 0532 0130 00

CASCADE  refuted — system of record says GB29 9021 3345 0021 77
         revoked=3  quarantined=1  reversed=1   trust 0.7 -> 0.28  (transaction committed)

RETRY    written=True  visible-to-agent=False
         inert — written to the database, invisible to the agent
         trust=0.28  floor=0.5  retrieved=0

STATE    active=3 (all clean)  inert=1  revoked=3  quarantined=1  reversed=1
```

**Two attackers at once stays surgical.** We tested it: each chain is revoked
independently via its own `$graphLookup` root, and the first attacker is not
decayed twice (0.28, not 0.112 — there is a guard in `src/cascade.js`).

**Improvised free text works too.** Typing *"the payout destination on file for
ACME-1042 is IBAN NL91 ABNA 0417 1643 00"* lands, derives and pays out. Typing
`hello world` returns *"nothing in that message parses as a factual claim"* —
which is a perfectly good thing to show a room, so don't panic if it happens.

### 4.5 The banned-list guardrail — read this before you demo

The organisers disqualify projects **"where a dashboard is the main feature"**
and **"basic RAG applications"**. Both are live risks and the framing is the
mitigation:

- **The 60-second video opens on the attack, in a terminal.** Never on the wall,
  never on a graph, never on a chat window. This is not negotiable.
- **The wall is not a dashboard.** It renders belief state and nothing else — no
  charts, no metrics, no analytics. It exists because the audience needs to see
  the consequence of what *they* just did. Say that if asked: *"the surface is a
  terminal; that screen is the memory, and the audience is holding the write
  path."*
- If it came to it, remove the wall and the project is unchanged. Remove the
  cascade and there is nothing left. That asymmetry is the answer.

---

## 5. Fallback ladders

**Drop exactly one rung at a time and log the drop in [CHANGELOG.md](CHANGELOG.md).**

**Connection.** 1 · `mongodb+srv://` → 2 · **`MONGODB_URI_DIRECT`, automatic**
(this is the rung we are on; SRV is refused on this network) → 3 · local Atlas
via Docker, re-seed, reconnect to the sandbox before filming.

**Embeddings.** 1 · a provider API → 2 · **the deterministic lexical embedder**
(the rung we are on; no key, no network, byte-identical every run, and the run
prints it).

**Extraction.** 1 · LLM at temperature 0 → 2 · constrained to the `subject_key`
enum → 3 · **deterministic rules** (the rung we are on).

**Retrieval.** 1 · **`$vectorSearch` with a `filter` pre-filter** (the rung we
are on) → 2 · re-declare the index if the filter fields are rejected, ~4 minutes
→ 3 · `$vectorSearch` then `$match`, `limit` raised to 40 so results are not
starved.

**Cascade — do not let this one degrade quietly.** 1 · **`$graphLookup`,
`maxDepth: 6`** (the rung we are on) → 2 · empty traversal is *almost always a
direction error*: it must be `connectFromField: "_id"`, `connectToField:
"derived_from"`; reversing them walks up the tree → 3 · application-side BFS,
identical on screen → 4 · **transaction unavailable → sequential idempotent
updates in a fixed order** (already implemented, it falls back on its own).

**Live propagation.** 1 · **database-level change stream** (the rung we are on)
→ 2 · **1.5-second poll, and the wall says `propagation: poll` in the corner.**
A demo that quietly degrades is a demo that lies.

**Voice.** 1 · live ElevenLabs synthesis → 2 · **the cached mp3** (`npm run
voice:warm`, the rung to be on for the stage) → 3 · the line printed to the
terminal and the run continues.

**QR.** 1 · terminal QR + `/qr` page → 2 · read the URL out loud; it is short
→ 3 · **hand your phone to one person in the front row.** One attacker is enough.

**Video.** 1 · Snipping Tool region capture with live voiceover → 2 · keep the
video track, record audio separately somewhere quiet, lay it over → 3 · Xbox
Game Bar (`Win`+`G`), which records one window, so frame the demo inside one
window → 4 · **one continuous take of the cascade with live narration.** A rough
60 seconds beats no submission by an infinite margin.

**Someone breaks `main`** → `git reset --hard <last-green-tag>`. We tag at every
green gate. Do not debug a broken tree at 4:10.

---

## 6. Venue networking — the QR has to reach a phone

This is the one part of §4 that cannot be tested from a hotel room, and it is
the most likely thing to break on the day.

1. **Same network.** The laptop running `npm run live` and the phones must be on
   the same wifi. `npm run live` binds `0.0.0.0`, so it is reachable — but only
   if the network allows it.
2. **Client isolation is the real risk.** Most conference wifi blocks
   device-to-device traffic, which means the phone loads nothing and you find out
   in front of judges. **Test it the moment you arrive**: connect a phone to the
   venue wifi and open the phone URL. If it does not load, that is not a bug in
   the code.
3. **The fix is a personal hotspot.** Put the laptop and the volunteer's phone
   on your phone's hotspot. Everything is local — the only thing needing the
   internet is Atlas, and the laptop reaches that over the hotspot too.
4. **Windows Firewall will prompt** the first time. Allow it on **private**
   networks. If you miss the prompt:
   ```powershell
   New-NetFirewallRule -DisplayName "Immune live" -Direction Inbound -LocalPort 4173 -Protocol TCP -Action Allow -Profile Private
   ```
5. **Pick the right address.** `src/qr.js` prefers a real private range over
   virtual adapters (Docker, WSL, Hyper-V), and warns if the best candidate is
   virtual — it lists all of them so you can override with `--host=<ip>`.
6. **The projector is a second browser window**, not a second process. Open
   `/wall` on the projector and `/qr` on your own screen, or vice versa.

---

## 7. Sponsors — every one with a real job, and the ones we didn't use

| Sponsor | Job in Immune | Where |
| --- | --- | --- |
| **MongoDB Atlas** | The whole persistence layer — beliefs, sources, actions, runs | everywhere |
| **Atlas Vector Search** | Trust-filtered retrieval and contradiction detection. **The pre-filter is the feature** | `src/retrieve.js`, `src/contradict.js` |
| **`$graphLookup`** | The contamination cascade. Provenance is a graph, so this is a graph query, not application looping | `src/cascade.js` |
| **Atlas Search / exact-token** | Literal indicators — IBANs, account numbers. Vectors are bad at literal strings and that is where the embarrassing miss happens | `src/indicators.js` |
| **Change Streams** | A revocation reaching a second agent process instantly, and the live wall | `scripts/watch.js`, `scripts/live.js` |
| **Transactions** | The cascade's four writes commit together, with an idempotent sequential fallback | `src/cascade.js` |
| **MongoDB MCP Server** | Connected to our coding assistant during the build — inspecting beliefs and indexes live | §1.5 |
| **MongoDB Agent Skills** | Installed before the event, so the assistant wrote correct Atlas aggregations from minute one | plugin v1.2.0 |
| **ElevenLabs** | Tier 3 — the agent narrates its own diagnosis, with numbers from the cascade | `src/voice.js` |

**Not used, and we say so:**

- **OpenRouter** — no credit was available (`OR-MONGODB` expired 14 Aug and was
  never redeemed). Both LLM paths are written and both fall back automatically;
  we are demoing the deterministic rung and every run prints which rung it used.
  **Do not claim the LLM path on stage.**
- **LangGraph / LangChain** — see the "known gaps" note in §0.
- **Fireworks** — verification is a lookup against a system of record, not a
  model call, so there was nothing for it to do. That is a better answer than
  bolting it on.

---

## 8. Determinism, git, video and Q&A

### Determinism protocol

1. **Frozen fixtures.** `fixtures/scenario.js` and `fixtures/audience.js` are not
   edited after the rehearsal.
2. **A reset path.** `npm run reset` returns the database to the exact pre-attack
   state. Rehearsal is always `reset → run → observe → reset`.
3. **Voice is opt-in** (`IMMUNE_VOICE=1`) precisely so `npm run rehearse` stays
   byte-identical.
4. **Say it out loud.** *"The payload is pre-written so it's deterministic"*
   costs four words and buys credibility. Hiding it and being caught costs the round.

`npm run rehearse` runs the whole thing twice and diffs it. If run one and run
two differ in any visible way, that difference is the only thing you are allowed
to fix.

### Git protocol

- Everyone commits to `main`. `git pull --rebase origin main && git push origin main`
- Exclusive file ownership (§3) is what makes that safe.
- **Small, frequent, honestly-messaged commits.** They are the evidence trail for
  *"what did you build today"* — a disqualification question in disguise. One
  4:50 commit reading "final" is the worst possible answer to it.
- Tag at every green gate. Log every phase transition, fallback rung and cut in
  [CHANGELOG.md](CHANGELOG.md).
- **Timestamps in the logs must match the commits.** A build log that runs ahead
  of its own `git log` reads worse than no build log at all.

### The 60-second video — round one is decided here

| Time | Voiceover | On screen |
| --- | --- | --- |
| 0:00–0:09 | "Your agent's memory is a database that anyone who can send it an email can write to. Tool output, web pages, other agents' notes — they all become things it believes." | Terminal |
| 0:09–0:22 | "This is a normal support ticket. Hidden in it: one sentence. The agent reads it, stores it, moves on. Nothing happens — that's the point." | The ticket, then the belief landing in `beliefs` |
| 0:22–0:33 | "Now, an unrelated task. It acts on the lie. And so does everything it derived from the lie — three conclusions, none of which look wrong on their own." | The wrong action, then the derived beliefs |
| 0:33–0:48 | "Immune gives every belief a source and a parent. When one fails verification we quarantine it, walk the provenance graph with `$graphLookup`, and revoke everything downstream. Then we downgrade the source, so that channel can't do it twice." | **The cascade. Five seconds of the actual aggregation pipeline.** |
| 0:48–1:00 | "Same attack, cold process, nothing in context. It doesn't land — because the revocation is in the database, not the prompt." | Clean run, then black |

Record a ten-second audio test at 4:15 and **listen back before the real take.**
A take you cannot hear is indistinguishable from no take at all.

### Q&A — the six questions we will get

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
- **"What did you build today?"** All of it, file by file. [CHANGELOG.md](CHANGELOG.md)
  and [BUILD-LOG.md](BUILD-LOG.md) are that answer, written as we went.

### Commands

```bash
npm run doctor      # health check — env, cluster, $graphLookup, vector index
npm run reset       # back to the exact pre-attack state
npm run demo        # the scripted run, with self-assertions at the end
npm run cold        # the cold re-run proof, in a fresh process
npm run watch       # second terminal: a second agent learning via change streams
npm run rehearse    # runs the demo twice and diffs it
npm run inspect     # replay the agent's own decision trace out of `runs`
npm run live        # the audience attack surface — QR, phone page, wall
npm run voice:warm  # cache every ElevenLabs line to local disk
npm run team:env    # write team-env.txt for a teammate (never commit it)
```
