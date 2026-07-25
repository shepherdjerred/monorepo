---
id: log-2026-05-22-scout-emitted-metrics-audit
type: log
status: complete
board: false
---

# Scout Emitted Metrics Audit

## Summary

Audited Scout metric definitions, emit sites, and dashboard/alert consumers for Discord, cron, prematch, Riot API, scheduled reports, report rendering, provider health, leaderboard charts, S3 snapshot loading, recovery, usage, and limit gauges.

## Session Log — 2026-05-22

### Done

- Passed Discord guild context through post-match, prematch, and offline notification sends so `discord_permission_errors_total` and `discord_owner_notifications_total` carry real guild labels instead of falling back to `guild_id="unknown"`.
- Removed the unused `scheduled_report_budget_exceeded_total` metric and the matching Grafana/PrometheusRule consumers because the report engine caps rows and does not reject runs for a configured budget.
- Kept scheduled-report singular/plural metric aliases, adding a comment that the plural `scheduled_reports_*` families are the dashboard-facing aliases during migration.
- Split empty-leaderboard chart skips into `skipped_empty_leaderboard` instead of incorrectly counting them as `skipped_too_few_snapshots`.
- Changed failed S3 snapshot fetches from `parse_error` to `error`; parse errors remain reserved for invalid JSON/schema failures.
- Updated `packages/scout-for-lol/docs/backend.md` to use the current emitted Discord metric names.

### Remaining

- No code follow-up remains from this audit.
- The older scheduled SQL reports plan still mentions the originally planned budget-rejection metric as historical plan text.

### Caveats

- `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck` passed after installing Scout dependencies and generating the Prisma client; the generate wrapper itself exited nonzero at the Prettier step because `prettier-plugin-astro` was not resolvable from the backend package context, after Prisma generation and branded types had completed.
- `cd packages/homelab/src/cdk8s && bun run typecheck` passed.
- `bun run --filter='./packages/scout-for-lol/packages/backend' lint` passed.
- `cd packages/homelab/src/cdk8s && bun run lint` failed before file diagnostics with ESLint `ResolveMessage {}`, including when scoped only to the two changed homelab files.
