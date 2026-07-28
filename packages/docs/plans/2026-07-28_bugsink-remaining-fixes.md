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

## Session Log — 2026-07-28

### Done

- BSC: `scripts/deploy-site.ts` `extraExcludes: ["data/*"]` so Temporal's
  `data/manifest.json` survives site deploys.
- Scout: `@@index([puuid])` migration; `PRAGMA busy_timeout` + WAL; combined
  post-match cursor write; `CompetitionStatusSchema.parse` at player/competition
  API boundaries; SPA Monaco `ignoreErrors`.
- Temporal: glitter WFT concurrency 2; agent non-retryable 401/429 with
  lastLine in error message; homelab-audit `maxTurns` 8→40; GH App token retry.
- Bugsink UI: resolved 8 Tier-0 noise/fixed issues (streambot, glitter, connect
  refused, GH 503, lock timeout, Monaco Canceled).
- Verify: typecheck/test/lint green on temporal, scout backend/app, root-scripts.

### Remaining

- Ops: rotate temporal-worker `OPENAI_API_KEY` (Codex 401).
- Ops: restore BSC `data/manifest.json` if still 404 after next fetch/deploy.
- Claude weekly quota resets Jul 29 5pm PT — agent failures until then.
- Prisma migration must roll out with scout backend deploy.
- Leave open: Scout Zod/Prisma events until deploys prove quiet; remaining
  Claude/Codex historical issues until ops/quota clear.

### Caveats

- Competition status fix is fail-loud at API; SPA still parses. Skew will still
  crash if an old backend ships without `status` — lockstep deploys required.
- `template.db` regenerated with the new Account index.
