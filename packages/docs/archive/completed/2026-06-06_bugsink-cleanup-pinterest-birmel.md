---
id: reference-completed-2026-06-06-bugsink-cleanup-pinterest-birmel
type: reference
status: complete
board: false
---

# Bugsink cleanup: silence Pinterest noise + fix Birmel OTel logger recursion

## Context

Triage of `bugsink.sjer.red` left a handful of open issues. Investigation showed
most were already handled and only **two needed code changes**:

- **Pinterest (`scout-for-lol` marketing site):** `TypeError: Failed to fetch (ct.pinterest.com)`
  — a third-party Pinterest conversion-tag script failing in visitors' browsers
  (ad-blockers / privacy extensions). Not our code, not actionable. Silenced.
- **Birmel `RangeError: Maximum call stack size exceeded`** — a genuine infinite
  recursion between the app logger and OpenTelemetry's diagnostic channel. Still
  firing on the deployed image (`2.0.0-3289`), last seen 6/6 19:06. Fixed.

The other Birmel issues were already resolved by commit `e3aa7407f` (DAVE package
and the `this.target.client` send-binding), which is in the deployed image
`2.0.0-3289` and silent since 6/3; the Discord `HTTPError 500` is transient
upstream.

## Changes

| Area                   | File                                                                | Change                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| scout marketing Sentry | `packages/scout-for-lol/packages/frontend/src/layouts/Layout.astro` | `beforeSend` returns `null` for Pinterest-origin errors (matches exception value `/pinterest/i` or a `pinimg.com`/`pinterest` stack frame) |
| birmel logger          | `packages/birmel/src/utils/logger.ts`                               | `emitOtlp` re-entrancy guard + `otlpLogsEnabled` flag; export `setOtlpLogsEnabled`                                                         |
| birmel tracing         | `packages/birmel/src/observability/tracing.ts`                      | `setOtlpLogsEnabled(false)` before `loggerProvider.shutdown()`; `setOtlpLogsEnabled(true)` after `setGlobalLoggerProvider`                 |
| birmel test            | `packages/birmel/tests/utils/logger.test.ts` (new)                  | Proves a re-entrant `getLogger()` no longer overflows and that disabling stops emission                                                    |

### Root cause (RangeError)

`emitOtlp()` → `logsAPI.getLogger(scope).emit()`. After the OTel `LoggerProvider`
is shut down, `getLogger()` calls `diag.warn('A shutdown LoggerProvider cannot
provide a Logger')`. The diag channel is wired to the app logger
(`tracing.ts` `otelDiagLogger`), so `diag.warn → logger.warn → emitOtlp →
getLogger → diag.warn …` recurses until the stack overflows. The re-entrancy
guard cuts the loop; the shutdown flag stops emitting to a torn-down provider.

## Bugsink resolutions

Resolved via the authenticated web UI bulk action (`POST /issues/<project>/`,
`action=resolved_next`) — the canonical REST API is read-only.

- Resolved during the session (already-fixed / transient): SQLite ×2, dev Vite
  import, sjer.red AbortError, Spectator upstream, 20× S3 signature, Birmel
  `this.target.client`, Birmel DAVE, Birmel Discord 500.
- Resolve post-deploy (reopen on next event otherwise): Pinterest `70f32fda`,
  Birmel `RangeError` `1360eb94`.

## Verification

- `packages/birmel`: `bun run typecheck` ✓, `bun --env-file=.env.test test` ✓
  (128 pass / 5 skip / 0 fail, incl. new logger test), `bunx eslint` ✓.
- `packages/scout-for-lol/packages/frontend`: `bun run typecheck` ✓, `bun run build`
  ✓ (with dummy `PUBLIC_*` env), filter confirmed present in the bundled script.

## Out of scope

- Discord 500 retry tuning (upstream, not actionable).
- Music buffering/catch-up follow-up noted in prior analysis.
