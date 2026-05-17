# Bugsink Open Bugs Triage

## Status

Complete

## Findings

- Queried `https://bugsink.sjer.red` across all 12 Bugsink projects.
- Found three unresolved, unmuted issues:
  - Temporal `e0a5b7f4-8655-4553-8def-e67d97265b7f`: 36 events, last seen 2026-05-16 13:05 UTC. Latest events abort inside `web-tree-sitter` when `packages/temporal/src/lib/symbol-index.ts` creates a new parser during `prReviewPipeline` bootstrap. Event tags include `provider_error=anthropic_rate_limit`, `component=pr-review-pipeline`, `specialist=correctness`, and `repo=shepherdjerred/monorepo`.
  - Scout for LoL `e9e39f7f-61da-4a56-9673-8a03054e844d`: 113 events, last seen 2026-05-16 08:07 UTC. OpenAI SDK returns 429 quota/billing errors from the review pipeline in beta release `2.0.0-2473`.
  - Scout for LoL `9e2ff5c4-2769-4248-809b-e2cfc91f5c1b`: 18,878 events, last seen 2026-05-16 01:14 UTC. Latest captured event is `API request timed out after 30000ms`; breadcrumbs show the post-match report path for `NA1_5561137625`, tracked player Brandon, and a preceding `rank` Riot API call timeout.

## Likely Fixes

- Temporal: make symbol-index parsing single-threaded or otherwise serialize `web-tree-sitter` parser construction/use. The abort happens while processing batches at concurrency 8, and repeated sampled events share the same `new Parser()` failure point.
- Scout OpenAI quota: treat OpenAI 429 quota/rate-limit failures as expected operational skips in the AI review path, similar to `OpenAIBudgetExceeded`, or gate calls more aggressively before reaching provider quota.
- Scout Riot rank timeout: avoid failing the whole post-match report when optional rank lookup times out. `getRanks()` currently uses `callRiotOrThrow`; the report can degrade to missing ranks instead of capturing `process-match-throw`.

## Session Log - 2026-05-16 - Triage

### Done

- Loaded `bugsink-helper` and `typescript-helper`.
- Queried Bugsink projects, unresolved/unmuted issues, latest events, stacktraces, and event context.
- Inspected relevant source paths:
  - `packages/temporal/src/lib/symbol-index.ts`
  - `packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts`
  - `packages/scout-for-lol/packages/backend/src/league/tasks/postmatch/match-report-ai-review.ts`
  - `packages/scout-for-lol/packages/backend/src/league/model/rank.ts`
  - `packages/scout-for-lol/packages/backend/src/utils/timeout.ts`

### Remaining

- Implement the three fixes above if desired.
- Re-query Bugsink after deployment to confirm the issues stop receiving events, then resolve them.

### Caveats

- `toolkit bugsink projects` failed locally because the bundled `toolkit` binary could not load its `lancedb` native binding, so the triage used the Bugsink REST API directly.
- No production code was changed in this session.

## Session Log - 2026-05-16 - Fixes

### Done

- Updated `packages/toolkit/src/index.ts` to lazy-load subcommand handlers so `toolkit bugsink ...` no longer imports recall/LanceDB on startup.
- Added Scout provider metrics for Prometheus/Alertmanager-driven notification:
  - `packages/scout-for-lol/packages/backend/src/alerts/provider-metrics.ts`
  - `packages/scout-for-lol/packages/backend/src/metrics/index.ts`
  - `packages/scout-for-lol/packages/backend/src/league/review/generator.ts`
- Changed Scout rank lookups in `packages/scout-for-lol/packages/backend/src/league/model/rank.ts` to degrade to empty ranks on Riot timeout instead of aborting the post-match report.
- Added focused Scout tests for OpenAI provider classification and Riot rank timeout fallback.
- Fixed Scout test-template DB generation so `scripts/generate-test-template-db.ts` applies checked-in SQLite migrations directly instead of depending on the failing Prisma schema-engine `db push` path.
- Fixed the fresh-DB `20260512045704_add_competition_season_relation` migration to preserve competition notification/schedule columns and the `nextScheduledUpdateAt` index while rebuilding the table.
- Updated Temporal PR-review provider failures to emit Prometheus metrics instead of Bugsink/Sentry for Anthropic credit/rate-limit paths:
  - `packages/temporal/src/activities/pr-review/provider-metrics.ts`
  - `packages/temporal/src/observability/metrics.ts`
  - `packages/temporal/src/activities/pr-review/specialists/anthropic-provider-errors.ts`
  - `packages/temporal/src/activities/pr-review/specialists/runner.ts`
  - `packages/temporal/src/activities/pr-review/specialists/correctness.ts`
  - `packages/temporal/src/activities/pr-review/summary.ts`
- Added `ScoutAiProviderIssueActive` and `TemporalAiProviderIssueActive` PrometheusRule alerts. Alertmanager/PagerDuty handles delivery from those warning-severity alerts.
- Added a provisioned Grafana dashboard for the provider-alert path:
  - `packages/homelab/src/cdk8s/grafana/ai-provider-dashboard.ts`
  - `packages/homelab/src/cdk8s/src/resources/grafana/index.ts`
  - Dashboard title: `AI Provider Health`
  - Panels cover active provider issues, Scout/Temporal active gauges, 24h provider errors, error rates by app/provider/kind/source, and quota vs rate-limit trends.
- Verified:
  - Scout targeted tests: `bun test src/alerts/provider-metrics.test.ts src/league/model/rank.test.ts`
  - Scout backend typecheck after regenerating the Prisma client and test template DB
  - Temporal targeted tests: `bun test src/activities/pr-review/specialists/runner.test.ts`
  - Toolkit typecheck, lint, and compiled `bugsink --help`
  - Scout changed-file lint
  - Temporal changed-file lint
  - Homelab cdk8s typecheck
  - Homelab Grafana dashboard export tests
  - Homelab cdk8s build generated the `ai-provider-dashboard` ConfigMap in `dist/apps.k8s.yaml`
  - Homelab helm-template test after cdk8s build
  - Prettier check for all touched files

### Remaining

- Deploy Scout, Temporal worker, Toolkit, monitoring rules, and the Grafana dashboard; then re-query Bugsink after new events have aged out and resolve the closed issues.

### Caveats

- Temporal package-level `typecheck` still reports an existing `src/event-bridge/triggers.ts` index-signature access after dependency setup; targeted tests and changed-file lint passed.
- The skipped Scout match should still count for S3-backed competition metrics because raw match data is saved before rank lookup; rank-history-only metrics may miss a transition for that match.
