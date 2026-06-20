# Scout-for-LoL: Guild-removal lifecycle + DM audit log

## Status

Partially Complete — code shipped in PR; one-time prod cleanup + Bugsink resolve pending post-deploy.

## Context

A Bugsink issue (`ChannelSendError ... [Discord Permission Error]`, channel `1455597334636265679`) fired **every day at 5 PM Pacific** for Scout-for-LoL prod. It traced to one server (`serverId 1345142904942760018`, owner `_hydr0o_`) that added the bot 2025-12-30, set up a "Ranked" competition, but **never granted Send Messages** — `lastSuccessfulSend` null, `consecutiveErrorCount` 138.

Root problems (all verified in code):

1. **Owner notifications can't reach an owner of a guild we've left, and fail silently** — both DM paths fetch the guild + owner first (`permissions.ts`, `abandoned-guilds.ts`), which throws `Unknown Guild` once the bot is gone, swallowed as `dm_failed`.
2. **Orphaned competition/report keep dispatching forever** — abandoned cleanup preserved `Competition`/`Report`; `syncSystemReports` regenerates, the dispatcher re-sends daily → `Missing Access (50001)` → counter climbs → `ChannelSendError` to Sentry.
3. **No `guildDelete` handler** — a kick/leave triggered no reactive cleanup.
4. **No guild-membership filter on polling** — `getAccountsWithState` returned all players; dead-guild players still hit the Riot API daily.
5. **Dispatcher had no per-report try/catch** — one dead report could abort the batch and bubble to Sentry.
6. **`ownerNotified` one-way latch** — once set, the abandoned path never re-engaged.
7. **In-guild notification spam** — owner DM'd on _every_ failed send.

Plus two owner requirements: **a feedback-request DM on removal**, and **a central audit log for ALL DMs**.

## What shipped

| #   | Change                                                                                                                                                                   | Key files                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `DmAuditLog` model + migration; `sendDM` is the single audited chokepoint (returns `DmStatus`, writes one row per attempt, best-effort)                                  | `prisma/schema.prisma`, `prisma/migrations/20260619000000_add_dm_audit_log/`, `discord/utils/dm.ts`                                                          |
| 2   | Routed **every** DM through `sendDM` (kinds: permission_error, abandonment, feedback_request, competition_invite, prune_notice, outreach_3d/14d/manual, data_validation) | `permissions.ts`, `abandoned-guilds.ts`, `prune-players.ts`, `competition/invite.ts`, `outreach/index.ts`, `cleanup/validate-data.ts`, `scripts/outreach.ts` |
| 3   | `guildDelete` handler (guards `!guild.available` for outages) → `cleanupRemovedGuild` + best-effort feedback DM                                                          | `discord/events/guild-delete.ts`, `discord/client.ts`                                                                                                        |
| 4   | `cleanupRemovedGuild(db, serverId)` — atomic, FK-safe, idempotent delete of Competition/Report/Subscription/ServerPermission/Account/Player/GuildPermissionError         | `league/tasks/cleanup/remove-guild.ts`                                                                                                                       |
| 5   | Dispatcher: skip non-member guilds (`client.guilds.cache.has`) + per-report try/catch                                                                                    | `reports/discord-dispatcher.ts`                                                                                                                              |
| 6   | Abandoned flow: unfetchable guild → `cleanupRemovedGuild`; departure DM via `sendDM` + feedback link; message no longer promises 30-day preservation                     | `league/tasks/cleanup/abandoned-guilds.ts`                                                                                                                   |
| 7   | Polling: `getAccountsWithState(db, activeServerIds?)` filters to live guilds; callers pass `getActiveServerIds()` (guarded on `client.isReady()` + non-empty cache)      | `database/index.ts`, `discord/utils/guild-membership.ts`, `active-game-detection.ts`, `match-history-polling.ts`                                             |
| 8   | Gate in-guild notify to first-error-of-streak (`recordPermissionError` returns `isFirstInStreak`)                                                                        | `database/guild-permission-errors.ts`, `league/discord/channel.ts`                                                                                           |
| —   | `FEEDBACK_URL` config; `client.ts` skips Discord login under `NODE_ENV=test` (import-safety)                                                                             | `configuration.ts`, `discord/utils/feedback.ts`, `discord/client.ts`                                                                                         |

### Notes / gotchas hit

- The `brand-prisma-types` script brands **any** field named `status` as `ParticipantStatus` (ReportRun works around it with a model override). The new audit column is named **`deliveryStatus`** to avoid that global collision.
- Importing `client.ts` pulls its whole command tree; `active-game-detection.test.ts` mocks `guild-membership.ts` so the partial DB mock isn't broken, and `client.ts` now skips login in test env.

## Verification (done)

- `bun run typecheck` ✅ · `bun test` (975 pass / 0 fail) ✅ · `bunx eslint .` ✅ · `knip` (no new findings) ✅
- New tests: `remove-guild.test.ts` (cleanup correctness + idempotency + cross-guild isolation), `dm.test.ts` (sent/dm_disabled/failed audit rows), `get-accounts-with-state.test.ts` (membership filter), `feedback.test.ts`, `guild-permission-errors.test.ts` (first-in-streak), updated `permissions-notify.test.ts`.

## Remaining (post-deploy)

1. After the image deploys, run `cleanupRemovedGuild(prisma, "1345142904942760018")` in the `scout-prod` pod (`ownerNotified=1` means the abandoned sweep won't pick it up). Verify no new Bugsink events after the next `00:00 UTC`, then resolve Bugsink issue `b0de3030-c8b3-4cdb-bb93-7e908ee67920`.
2. Optional follow-up: ESLint guard forbidding raw `.send(` on a `User` outside `dm.ts`.
