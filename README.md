# IMMUNE

**An immune system for agent memory.**

Built at the MongoDB .local Build Fest — *The Persistent Context Sprint*,
13 August 2026, Pier 48, San Francisco. Everything in this repository was
written inside the 1:30–5:00 PM PT build window; see [BUILD-LOG.md](BUILD-LOG.md).

> Build in progress. Full README lands at the P7 gate.
> Team setup and lane assignments: **[COORDINATION.md](COORDINATION.md)**.

---

## In one line

If someone tricks an agent into believing something false, Immune finds out,
forgets it, and undoes every decision the agent made because of it.

## Quick start

```bash
npm install
cp .env.example .env    # paste the cluster URI
npm run doctor          # must be all green before anything else
npm run demo
```
