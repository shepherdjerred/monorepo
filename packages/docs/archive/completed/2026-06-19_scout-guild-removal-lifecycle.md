---
id: reference-completed-2026-06-19-scout-guild-removal-lifecycle
type: reference
status: complete
board: false
---

# Scout-for-LoL: Guild-removal lifecycle + DM audit log

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

## Phase 2 — Escalating notifications + remove auto-leave + guild-health dashboards

Refinement on the same branch after PR-1, per owner feedback ("backed-off retry" + Grafana tracking):

- **Backed-off owner notifications** replace notify-once-per-streak. `GuildPermissionError` gains `notificationStage` + `lastNotifiedAt`; `recordPermissionError` returns `none | immediate | week | month` (immediate on first failure, week at +7d, month at +30d after that, then silent). Anchored on `lastNotifiedAt` (not `firstOccurrence`) so **existing mid-streak guilds** restart cleanly at `immediate` instead of jumping to `month`. Stage-specific DM copy in `permissions.ts` (`notifyServerOwnerAboutPermissionError` is now an options object taking `stage`).
- **Removed the 7-day auto-leave.** The bot never leaves on its own; `checkAbandonedGuilds` is replaced by `reconcileRemovedGuilds` (cleanup-only sweep for guilds the bot was removed from while offline). Deleted `getAbandonedGuilds`/`markGuildAsNotified`/`notifyOwnerOfAbandonment`, the `abandonment` DM kind, and the abandoned-\* metrics. Cleanup + feedback DM now happen only on real uninstall (`guildDelete`).
- **Guild-health observability.** New gauges in `metrics/guild-health.ts` set every 5 min in `updateUsageMetrics`: `guild_send_blocked{server_id}`+`_total`, `competition_unhealthy{server_id,competition_id}`+`_total`, `guild_info{server_id,server_name}`. New "Guild health" row in the homelab scout dashboard (`scout-dashboard-health-panels.ts`): two stat panels + two name-joined table panels.
- **Verification:** backend `typecheck` ✅ · `bun test` (970 pass / 0 fail) ✅ · `eslint` ✅ · `knip` (no new findings) ✅; homelab `typecheck` ✅ · `eslint` ✅ · grafana tests (14 pass) ✅ · dashboard JSON exports with all new panels. New/updated tests: escalation stage transitions incl. the existing-guild case, `reconcile-removed-guilds.test.ts`, `usage.test.ts` (health gauges); abandoned-guild tests removed.

## Phase 3 — close the silent-non-delivery gaps

A gap audit (3 Explore agents over send paths, generation/scheduler paths, and homelab alerting) found cases where the bot stops posting and nobody is told. Closed the high-value ones:

- **A — channel deleted / unreachable now escalates to the owner.** `channel.ts` unifies all "can't deliver to this channel" outcomes (missing perms, **channel not-found / Unknown Channel 10003 / Unknown Guild 10004 / not-text**) into one record+escalate path keyed by `errorType` (`permission` vs `channel_missing`), reusing the backed-off stages. `permissions.ts` gained `isMissingChannelError` + a `channel_missing` DM copy variant. Previously a deleted channel was Sentry-only.
- **C — operator PagerDuty alerts** (homelab `rules/scout.ts`, new `scout-bot-health` group): `ScoutDiscordDisconnected` (whole-bot-down, critical/5m — was unalerted), `ScoutCronJobStale` (a stalled cron, per `job_name`, 25h), `ScoutGuildDeliveryBlockedSpike` (>5 blocked guilds/2h — individual blocks are a user problem handled by the escalation DMs, so only a spike pages).
- **D — idle / never-configured guilds:** new `guild_unconfigured{server_id}` + `_total` gauges (installed, 0 subs & 0 active comps), a dashboard stat panel, and a one-time **30-day** outreach nudge (`GuildInstall.outreach30dSentAt` + migration; `runThirtyDayOutreach`).
- **Bonus:** extracted the Prometheus `registry` into `metrics/registry.ts` to break a latent import cycle (`index.ts` → `usage.ts` → `guild-health.ts` → `registry`) that surfaced as a TDZ in some test orderings.
- **Deferred (rationale in the plan):** transient send errors (operator domain), broken-PUUID polling staleness (ambiguous vs inactive), DMs-closed fallback, and the optional owner-DM-on-repeated-generation-failure (B).
- **Verification:** backend `typecheck`/`eslint`/`knip` ✅ · `bun test` (974 pass / 0 fail) ✅; homelab `typecheck`/`eslint` ✅ · scout-rules + grafana tests (18 pass) ✅ · dashboard exports the new panel. New tests: `isMissingChannelError`, `channel_missing` DM copy, `guild_unconfigured` gauge, `scout.test.ts` alert synthesis.

## Remaining (post-deploy)

1. After the image deploys, run `cleanupRemovedGuild(prisma, "1345142904942760018")` in the `scout-prod` pod. Verify no new Bugsink events after the next `00:00 UTC`, then resolve Bugsink issue `b0de3030-c8b3-4cdb-bb93-7e908ee67920`. Note: with the auto-leave removed, that guild is no longer swept automatically, so the explicit one-time cleanup is required.
2. Existing failing guilds will each receive one fresh `immediate` permission DM on their next failed send after deploy (then week/month). Expected and intended; watch `guild_send_blocked_total` on the new dashboard row to gauge the population.
3. Optional follow-up: ESLint guard forbidding raw `.send(` on a `User` outside `dm.ts`.

## Session Log — 2026-06-19

### Done

- PR-1 (commit `1b3040688`): DM audit log, `guildDelete` cleanup, dispatcher hardening, polling filter, feedback DM.
- Phase 2 (`99f777e54`): escalating owner notifications (`immediate`/`week`/`month`), removed the 7-day auto-leave in favor of `reconcileRemovedGuilds`, guild-health metrics + Grafana "Guild health" row. Existing-guild deploy behavior handled by `lastNotifiedAt` anchoring + an explicit test.
- Phase 3 (this session): channel-deleted/unreachable now escalates to the owner; operator PagerDuty alerts (disconnect / cron-stall / delivery-spike); idle-guild metric + 30-day nudge; extracted `metrics/registry.ts` to break an import cycle.

### Remaining

- Push the branch + open the PR (not yet done).
- Post-deploy one-time prod cleanup + Bugsink resolve (see `packages/docs/todos/scout-orphan-guild-prod-cleanup.md`).

### Caveats

- `ownerNotified` column is now unused (deprecated; left in place to avoid a SQLite table-rebuild migration).
- Escalation is tracked per `(serverId, channelId)`; a guild with multiple failing channels gets one track each (guild-level dedupe is a possible future refinement).
