---
id: reference-completed-2026-05-23-scout-ai-provider-deduplication
type: reference
status: complete
board: false
---

# Scout AI Provider Deduplication

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
