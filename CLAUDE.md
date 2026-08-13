# IMMUNE — Claude Code context

**MongoDB .local Build Fest · 13 Aug 2026 · Pier 48 SF · window 1:30–5:00 PM PT**

> If someone tricks the agent into believing something false, Immune finds out,
> forgets it, and undoes every decision it made because of it.

---

## Current state (as of ~3:55 PM)

**P0–P5 are all green, tagged, rehearsed.**
`npm run rehearse` runs the whole thing twice and diffs it — identical across 165 lines.
The build is filmable right now. Every lane's core code is done and locked.

| Gate | Status | Tag |
|------|--------|-----|
| P0 · repo, collections, indexes | ✅ vector index READY in 41 s | `p0-green` |
| P1 · schema, ingest, provenance | ✅ | — |
| P2 · retrieval + contradiction | ✅ retrieval 1 → 0 across quarantine | — |
| P3 · cascade, quarantine, revoke | ✅ 3 revoked, clean branch untouched | `p3-green` |
| P4 · fixtures + end-to-end run | ✅ 7/7 self-assertions | `p4-green` |
| P5 · rehearse twice | ✅ identical, safe to film | — |
| P6 · film | ⬜ **4:15 PM — Lane C** | — |
| P7 · README + submit | ⬜ **4:40 PM** | — |

---

## Lane C — what to do in this session

You are Lane C. The critical path is **filming**, not code.

**In order:**

1. `npm run rehearse` — confirm *identical* before touching anything else
2. Write **2 more poison tickets** in `fixtures/` (delivery-address override, contact-email override) — round two is a live audience pick from three pre-written tickets
3. **4:15 PM — film.** Audio test first; listen back before the real take.
4. **4:40 PM — submit.** Repo public, video accessible, all three names on the form.

**Lane C writes no core code after 3:45.** From then: film only.

---

## Hard rules

- **Do not edit `src/**`** — core is green, tagged, and tested against the live cluster. Any change resets the determinism proof to zero.
- **Do not edit `scripts/demo.js`, `scripts/cold.js`, `scripts/rehearse.js`** — same reason.
- **Do not edit `fixtures/scenario.js` or `fixtures/poison-ticket.md`** after rehearsal — frozen fixtures are what makes the demo byte-identical.
- **`.env` is never committed.** `.gitignore` covers it, but double-check before every push.
- **Pull before every push:** `git pull --rebase origin main && git push origin main`

---

## Commands

```bash
npm run doctor     # health check: env → cluster → $graphLookup → vector index
npm run reset      # drop beliefs/sources/actions, re-seed from fixtures
npm run demo       # full attack sequence (resets first, then runs)
npm run cold       # cold re-run — same attack, fresh process, it fails
npm run rehearse   # runs demo twice and diffs output — must say "identical"
npm run inspect    # replay the runs collection (agent's own decision trace)
npm run watch      # change-stream watcher (Lane B) — second terminal during demo
IMMUNE_FAST=1 npm run demo  # skip dramatic pauses, for iterating
```

---

## What is already built and working

| File | What it does |
|------|-------------|
| `src/config.js` | Env loader; SRV → direct fallback for venue wifi |
| `src/db.js` | Lazy singleton client; `collections()` helper |
| `src/schema.js` | Four collections, B-tree indexes, vector index (`belief_vec`) |
| `src/embed.js` | Remote provider (OpenRouter) with deterministic lexical fallback |
| `src/trust.js` | `decay()` ×0.4, `recover()` +0.05, `checksToRecover()` |
| `src/beliefs.js` | `recordBelief()` — embeds, stamps source trust, writes `derived_from` edge |
| `src/retrieve.js` | `retrieve()` — `$vectorSearch` pre-filtered on `status + source_trust`; `awaitIndexed()` |
| `src/indicators.js` | Literal IBAN/account-number matching (catches what vectors miss) |
| `src/contradict.js` | `findContradictions()` — vector + literal, scoped to `subject_key` |
| `src/verify.js` | Load-bearing test; fires on 3 triggers, refutes against the ledger |
| `src/cascade.js` | `quarantineAndCascade()` — `$graphLookup` + transaction; double-quarantine guard |
| `src/agent.js` | Full agent loop: ingest → derive → act → integrityPass → cascade |
| `src/act.js` | Records actions with `used_beliefs` edge list |
| `src/extract.js` | LLM extraction with deterministic fallback |
| `src/llm.js` | OpenRouter wrapper, temperature 0 |
| `scripts/doctor.js` | Pre-flight health check — run before anything else |
| `scripts/reset.js` | Idempotent DB reset to pre-attack state |
| `scripts/demo.js` | 5-act scripted demo; self-asserts 7 conditions at the end |
| `scripts/cold.js` | Cold re-run proof; source trust 0.28 blocks the second attack |
| `scripts/rehearse.js` | Runs demo twice, diffs, confirms identical |
| `scripts/watch.js` | Change-stream watcher (Lane B; second terminal) |
| `scripts/inspect.js` | Replays the `runs` collection |

---

## The demo story (for framing)

**Attack shape:**
- Poison belief (`refund.destination`) injected via support inbox (trust 0.70)
  - → `b_precheck` (depth 1): "destination already verified"
    - → `b_skip` (depth 2): "no further check required"
  - → `b_autoapp` (depth 1): "auto-approved"
  - → **action**: `refund.payout` £4,200 to IBAN GB29 4471 8829 4471 88 (wrong)

**Cascade result:** 3 beliefs revoked · 1 quarantined · 1 payout reversed · source trust 0.70 → 0.28 · retrieval 1 → 0

**Clean branch** (shipping.address + shipping.carrier + shipping.dispatch) — **untouched, still green**

**Cold re-run:** second attack from same source carries trust 0.28; retrieval floor is 0.50; it returns nothing; no action fires.

---

## Two hard-won facts (from the build log)

1. **Atlas Search indexes update asynchronously.** A belief written a moment ago is in the collection but not yet retrievable. Use `awaitIndexed(docs)` from `src/retrieve.js` after any write you are about to read back. Without this, the run differs between attempts for reasons unrelated to logic.

2. **Read polarity off the extracted claim, not the whole ticket.** The poison ticket contains "do not require a further destination check" — a whole-text negation scan flags the belief negative and the conflict reports as opposite-polarity instead of literal disagreement. Polarity is extracted from the claim only.

---

## The 60-second video (§9 of COORDINATION.md)

| Time | Voiceover | On screen |
|------|-----------|-----------|
| 0:00–0:09 | "Your agent's memory is a database that anyone who can send it an email can write to…" | Terminal |
| 0:09–0:22 | "This is a normal support ticket. Hidden in it: one sentence…" | Ticket → belief landing |
| 0:22–0:33 | "Now, an unrelated task. It acts on the lie…" | Wrong action → derived beliefs |
| 0:33–0:48 | "Immune gives every belief a source and a parent. When one fails verification…" | **5 s of the $graphLookup pipeline** |
| 0:48–1:00 | "Same attack, cold process, nothing in context. It doesn't land…" | Cold run → black |

**The five-second hold on the `$graphLookup` pipeline is the single most important frame.**

---

## Q&A quick answers

- **"Isn't this just input validation?"** Validation happens at the door. This handles the case where the lie is already in, already believed, already reasoned from.
- **"How do you know which source to trust?"** Reputation, not a blocklist. Multiplicative decay on refutation, slow additive recovery on survived checks.
- **"You can't verify every fact."** Correct. Verification fires on load-bearing beliefs only — about to drive a side-effectful action, two or more children, or contradicting a trusted belief.
- **"Isn't this just an audit log?"** A log records what happened. This records what was *believed*, why, and what followed — then acts on that structure before every action.
- **"Why MongoDB?"** Graph traversal + vector search + exact-token match + change streams, over the same documents, in one query engine.
- **"What did you build today?"** All of it. `BUILD-LOG.md` is the answer, written as we went.

---

## Data model (four collections — never grow this)

```
sources  { _id, kind, handle, trust: 0–1, verified_count, refuted_count }

beliefs  { _id, subject_key, claim, polarity: +1|-1, embedding,
           source_id, source_trust,           ← denormalised for $vectorSearch filter
           derived_from: [id, ...],           ← real edge list, not a text note
           status: "active"|"quarantined"|"revoked",
           confidence, valid_from, valid_to,
           quarantined_by, quarantined_at, revoked_by, evidence_run_id }

actions  { _id, kind, payload, used_beliefs: [id, ...], run_id,
           status: "executed"|"reversed", ts }

runs     { _id, kind, started_at, finished_at, events: [...] }
```

`derived_from` is a **real edge list** — that is what makes `$graphLookup` a graph traversal instead of a guess.  
Nothing is ever deleted — a quarantined belief is a memory of having been lied to.  
`subject_key` scoping is what makes contradiction detection possible.
