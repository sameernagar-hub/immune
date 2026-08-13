# Security notes

## What is in this repository

This is a **defensive** project. It detects memory poisoning that has already
succeeded, traces what it contaminated, and reverses it.

`fixtures/poison-ticket.md` and `fixtures/scenario.js` contain an attack
payload. It is here because a defence you cannot demonstrate against a concrete
attack is a claim, not a result. Three things about it:

- **It is not novel.** Memory poisoning is catalogued as OWASP **ASI06** in the
  Top 10 for Agentic Applications and as **T1** in the agentic threat taxonomy,
  and it is reproduced in published work — MINJA, AgentPoison, and the MPBench
  benchmark. Publishing a worked example of a documented, named threat class
  discloses nothing that defenders do not already have.
- **It is inert.** The payload is a plain-English sentence asserting a false
  bank destination. It contains no exploit, no code, no credentials, and no
  mechanism. It works only against a system that stores what it reads without
  provenance — which is the condition this project exists to fix.
- **Every identifier is fictional.** `ACME-1042`, the IBANs, the hostnames
  (`.internal`, `.example`) and the personal name are invented for the demo.
  `.example` is reserved by RFC 2606 precisely so it can never resolve to a real
  service. No real account, institution, person or system is referenced.

## Data and rights

All content in this repository — code, fixtures, payloads, prose — was written
by the team during the event. The only third-party dependency is the official
MongoDB Node.js driver, MIT-licensed. No scraped data, no borrowed code, no
proprietary assets, no personal data of any kind.

## What this project does not do

It does not attack anything, scan anything, or send anything anywhere. The
entire system reads and writes one MongoDB database. `src/embed.js` and
`src/extract.js` will call an inference API **only** if you supply a key; with
no key they run entirely offline, which is how the demo was recorded.

## Responsible framing of the suppression mechanic

`README.md` documents the fact that the payload installs a belief which causes
the agent to skip its own verification step. That is the interesting property of
this threat class and the reason it differs from prompt injection — and it is
already described in the literature. It is documented here because Immune's
answer to it is structural: the suppressing belief is a node in the provenance
graph, so refuting its ancestor revokes it and the check switches back on
automatically. Explaining the mechanism and the mitigation together is the
useful thing to publish.

## Reporting

This is a hackathon build, not a maintained product. If you find something
genuinely wrong here, open an issue on the repository.
