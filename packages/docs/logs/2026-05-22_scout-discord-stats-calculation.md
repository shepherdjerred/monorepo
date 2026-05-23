# Scout Discord Stats Calculation

## Status

Complete

## Summary

Answered how Scout calculates Discord-related Prometheus metrics.

## Session Log — 2026-05-22

### Done

- Loaded Discord and TypeScript guidance.
- Searched local recall for related Scout observability context.
- Traced Discord gateway metrics in `packages/scout-for-lol/packages/backend/src/discord/client.ts`.
- Traced database-backed usage and limit metrics in `packages/scout-for-lol/packages/backend/src/metrics/usage.ts` and `packages/scout-for-lol/packages/backend/src/metrics/limits.ts`.
- Clarified the difference between `discord_guilds` and `servers_with_data_total`.

### Remaining

- None.

### Caveats

- This was an explanation-only session; no code behavior was changed.
