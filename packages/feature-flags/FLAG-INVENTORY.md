# Monorepo feature-flag inventory

This is the reviewed boundary for runtime configuration. A value is listed as
“migrate now” only when the consumer can read a seeded snapshot or evaluate the
flag per request without reconstructing a boot-time object. The initial Flipt
value must match the current production value.

## Migrate now

| Consumer  | Flipt keys                                                                                                                                                                                                                                                   | Type and targeting                                          | Current source                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| Streambot | `player-card-enabled`, `subtitles-enabled`                                                                                                                                                                                                                   | Boolean; process snapshot                                   | `src/config/dynamic.ts`                       |
| Streambot | `streambot-subtitle-languages`, `streambot-subtitles-include-auto-generated`                                                                                                                                                                                 | String/Boolean; process snapshot                            | `src/config/schema.ts`                        |
| Streambot | `streambot-reconnect-enabled`, `streambot-reconnect-delay-seconds`, `streambot-reconnect-max-attempts`                                                                                                                                                       | Boolean/Number; process snapshot                            | `src/config/schema.ts`                        |
| Streambot | `streambot-player-card-tick-ms`, `streambot-player-card-repost-after-messages`, `streambot-idle-timeout-seconds`, `streambot-playlist-limit`                                                                                                                 | Number; process snapshot                                    | `src/config/schema.ts`                        |
| Scout     | `explore-guild-allowlist`, `llm-hourly-token-budget`, `llm-daily-token-budget`                                                                                                                                                                               | String/Number; backend snapshot                             | `packages/backend/src/config/dynamic.ts`      |
| Scout     | `scout-report-ai-model`, `scout-betting-parlay-ai-model`, `scout-explore-model`, `scout-bucks-ask-model`                                                                                                                                                     | String; backend snapshot                                    | `packages/backend/src/config/dynamic.ts`      |
| Scout     | `ai_reports_enabled`, `ai_reports_unlimited`, `ai_reviews_enabled`, `betting_enabled`, `debug`, `scout-consumer-player-profiles-enabled`                                                                                                                     | Boolean; guild/user/environment context on every evaluation | `packages/backend/src/configuration/flags.ts` |
| Karma     | existing admin/emoji flags                                                                                                                                                                                                                                   | String; guild context                                       | `packages/starlight-karma-bot/src/config.ts`  |
| Birmel    | `birmel-daily-posts-enabled`, `birmel-persona-enabled`, `birmel-responder-enabled`, `birmel-birthdays-enabled`, `birmel-activity-tracking-enabled`, `birmel-elections-enabled`                                                                               | Boolean; process snapshot                                   | `src/config/dynamic.ts`                       |
| Birmel    | `birmel-llm-model`, `birmel-llm-classifier-model`, `birmel-llm-memory-model`, `birmel-llm-embedding-model`, `birmel-persona-style-model`, `birmel-llm-reasoning-effort`                                                                                      | String; process snapshot                                    | `src/config/dynamic.ts`                       |
| Birmel    | `birmel-llm-max-output-tokens`, `birmel-agent-max-steps`, `birmel-agent-response-timeout-ms`, `birmel-agent-router-timeout-ms`, `birmel-responder-engagement-window-ms`, `birmel-responder-transcript-window-ms`, `birmel-responder-transcript-max-messages` | Number; process snapshot                                    | `src/config/dynamic.ts`                       |

## Redesign before migration

- Pokémon goal mode, screenshots, notifications, event notifications, command
  limits, and the web/API surface are read while booting commands or servers.
- Mario Kart leaderboard, driver feed, screenshot commands, web/API surface,
  stream settings, and encoder settings have the same lifecycle boundary.
- Birmel scheduler start/stop and schedule shape remain restart-scoped until a
  native pause/resume lifecycle exists. The daily-post product gate is safe now
  because each scheduler tick reads the cached config.

## Keep outside Flipt

- Credentials, feature-flag bootstrap variables, telemetry/Sentry, archive
  retention, CI/review switches, one-shot CLI options, and infrastructure shape.
- Birmel trusted-user grants, shell/browser/repository-editor capability, and
  Streambot voice activation or voice capture. Flipt has no authentication and
  voice capture persists human audio.
- Temporal schedule enablement, TaskNotes/user-owned settings, persisted Scout
  report/sound settings, and UI query-state booleans.

## Verification boundary

Dynamic definitions are typed with Zod and resolve `flag → env → default`.
Snapshot consumers are seeded from the existing production configuration, so a
missing flag, unavailable provider, or first-read race keeps current behavior.
Per-guild and per-user Scout policy decisions pass explicit context and default
closed. Guild command reconciliation visits every connected guild and sends an
empty replacement payload when a policy is disabled, removing stale commands.
