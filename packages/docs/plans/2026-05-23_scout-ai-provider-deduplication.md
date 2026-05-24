# Scout AI Provider Deduplication

## Status

Partially Complete

## Summary

Route expected Scout OpenAI operational failures through metrics, alerts, and dashboards instead of Bugsink. The noisy Bugsink groups were budget and context-limit failures with variable token counts in the error message, which caused duplicate issue groups.

## Implementation Plan

- Extend Scout provider issue kinds to include `budget_exceeded` and `context_limit` alongside `quota` and `rate_limit`.
- Classify `OpenAIBudgetExceeded` and OpenAI 400 context/input-token-limit errors as provider issues, record `ai_provider_errors_total`, set `ai_provider_issue_active`, and avoid `Sentry.captureException()` for those expected operational failures.
- Resolve all four provider issue kinds after a successful match review.
- Raise Scout OpenAI token budgets to `OPENAI_HOURLY_TOKEN_BUDGET=2000000` and `OPENAI_DAILY_TOKEN_BUDGET=20000000`.
- Process match-review OpenAI calls sequentially within a single review and lower timeline chunk completion budget from `32_000` to `2_000`.
- Keep unexpected failures, including Prisma/database and non-provider bugs, in Bugsink.
- Update the AI Provider Health dashboard so budget and context-limit failures are visible.

## Test Plan

- Add provider classification tests for quota, rate limit, budget exceeded, context limit, and unrelated errors.
- Add generator tests proving budget/context-limit failures record provider issue metrics and do not call Sentry.
- Add timeline pipeline tests proving chunk processing is sequential and uses the capped timeline chunk output token limit.
- Run Scout backend/data tests, Scout typecheck/lint, and homelab test/typecheck.

## Session Log — 2026-05-23

### Done

- Implemented Scout provider classification for `budget_exceeded` and `context_limit`, plus zero-value metric seeding and success-time gauge resolution.
- Raised Scout OpenAI token budget defaults and homelab deployment env values to `2000000` hourly and `20000000` daily.
- Removed unbounded intra-review OpenAI parallelism by making Stage 1 and timeline chunks sequential, and reduced timeline chunk output cap to `2_000`.
- Updated the AI Provider Health dashboard with budget/context-limit panels.
- Added focused provider, generator, and timeline pipeline tests.
- Verified Scout with `bun run --filter='./packages/backend' test`, `bun run --filter='./packages/data' test`, `bun run typecheck`, and `bun run lint`.
- Confirmed `git diff --check` is clean.

### Remaining

- Run `cd packages/homelab && bun run test` and `cd packages/homelab && bun run typecheck` once homelab dependencies can be installed in this checkout.
- After deploy, re-query Bugsink and resolve existing duplicate Scout AI budget/context-limit issues once metrics confirm the replacement path is active.

### Caveats

- Homelab dependency installation was blocked by the app escalation usage limiter, and no homelab `node_modules` directories are present in this worktree.
- The Scout frontend still emits an existing Astro inline-script hint during typecheck/lint, but both commands exit successfully.
