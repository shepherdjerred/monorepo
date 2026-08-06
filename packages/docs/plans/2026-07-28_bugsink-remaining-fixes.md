---
id: plan-2026-07-28-bugsink-remaining-fixes
type: plan
status: in-progress
board: false
---

# Bugsink remaining fixes

## Scope

One PR covering active Bugsink root causes (skip OpenAI prompt-policy):

1. BSC deploy must not delete Temporal `data/manifest.json`
2. Scout competition `status` fail-fast at API boundary
3. Scout Account `puuid` index + busy_timeout + combined cursor writes
4. Temporal glitter WFT concurrency 2, agent non-retryable 401/429, audit maxTurns 40
5. GH App token retry on 502/503/429/504
6. SPA Monaco `Canceled` ignoreErrors
7. Tier 0 Bugsink UI resolve (noise / already-fixed)

## Ops (human)

- Rotate/validate temporal-worker `OPENAI_API_KEY`
- After merge: restore BSC manifest if still 404
- Claude weekly quota resets Jul 29 5pm PT
