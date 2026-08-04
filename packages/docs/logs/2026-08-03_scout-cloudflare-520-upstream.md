---
id: scout-cloudflare-520-upstream-2026-08-03
type: log
status: complete
board: false
---

# Scout: treat Cloudflare edge 5xx as expected upstream errors

## Problem

Bugsink's single highest-volume issue was Scout's `GenericError: <none>` — 7332
events. Sampling 1000 of them showed **100% carry `httpStatus=520`**,
overwhelmingly `region=KOREA` (~95%), rest SINGAPORE / AMERICA_NORTH.

Riot's API is fronted by Cloudflare; **520** is Cloudflare's "Web Server
Returned an Unknown Error" — a transient edge↔origin failure, the same class as
502/503/504. But `getActiveGame` (`league/api/spectator.ts`) only diverts
`EXPECTED_UPSTREAM_ERROR_STATUSES` (`{502, 503, 504}`) to the warn-log +
circuit-breaker path; every other status with a value hits
`Sentry.captureException`. So each 520 was reported to Bugsink.

## Fix

Add the Cloudflare edge/connectivity 5xx statuses (520–524, 527) to
`EXPECTED_UPSTREAM_ERROR_STATUSES` in
`packages/scout-for-lol/packages/backend/src/league/api/upstream-errors.ts`.
These now route to the existing circuit-breaker path (warn log, `upstreamError:
true`) instead of error tracking. No other logic changed — `getActiveGame`
already branches on `isExpectedUpstreamError`.

525/526 (Cloudflare TLS handshake / invalid origin certificate) and 530
(Cloudflare's wrapper for the whole Error 1xxx range) are deliberately left
unexpected: the status alone cannot establish that the underlying condition is
transient rather than a persistent origin/config problem, so they must stay
visible in error tracking rather than be silently sampled away.

Added `upstream-errors.test.ts` covering: standard 5xx, the Cloudflare
520–524/527 range, non-upstream statuses (incl. 429/500/525/526/528/529/530
staying unexpected), `undefined`, `extractHttpStatus` numeric/string coercion,
and the 520 end-to-end regression.

## Verification

- `bun test upstream-errors.test.ts` → 8 pass / 0 fail.
- `bunx turbo run typecheck lint --filter=@scout-for-lol/backend` → 0 errors
  (only pre-existing code-duplication warnings in unrelated files).

## Session Log — 2026-08-03

### Done

- Added 520–524, 527 to `EXPECTED_UPSTREAM_ERROR_STATUSES`; added
  `upstream-errors.test.ts`. Verified via test + typecheck + lint.

### Remaining

- Merge + deploy. After deploy, unmute the Scout GenericError issue in Bugsink
  and confirm it stays quiet (no new 520 captures).

### Caveats

- Scope is deliberately the 520/Cloudflare flood only. 525/526 (TLS/certificate
  failures) and 530 (ambiguous Error 1xxx wrapper) are intentionally left
  unexpected — status alone can't establish transience for those. 528/529 are
  also intentionally left unexpected (not Cloudflare-origin edge errors). 429
  (rate limit) is unchanged — it was not the cause here (0% of the sampled
  events).
- Other open Scout Bugsink issues (Prisma `updateMany` timeout, frontend
  `CompetitionStatus` ZodError) are separate and not addressed here.
