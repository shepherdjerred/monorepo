# Monorepo feature-flag inventory

The language-neutral [managed inventory](src/managed-flag-inventory.json) owns
flag names, types, targeting, environment overrides, and default-off exceptions.
New boolean features default on in production and beta. A non-global rollout
requires an environment-scoped reason, AI issue, enablement criteria, and review
date in `defaultOffExceptions`. A deferred owner decision is recorded as such.

## Dynamic consumers

Streambot's `streambot-web-ui-enabled` gate is evaluated per server and user on
every authenticated media request in `src/config/media-features.ts`. It defaults
on in production. Web credential and
listener bootstrap stay outside Flipt.

Competitive LoL uses `streambot-lol-esports-enabled` for official schedules and
broadcasts, and `streambot-lol-autoplay-enabled` for one-time automatic playback.
Both are Boolean gates evaluated per server/user and default on in production.
They also require `streambot-sports-streaming-enabled`.
Scheduler credentials and the internal listener are bootstrap, outside Flipt.
Streambot and The Storm have one deployed production service each. Their beta
Flipt copies preserve targeting for testing and do not represent beta services.

| Consumer  | Flipt keys                                                                                                                                                                                                                                                      | Type and targeting                                          | Current source                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Streambot | `player-card-enabled`, `subtitles-enabled`                                                                                                                                                                                                                      | Boolean; process snapshot                                   | `src/config/dynamic.ts`                          |
| Streambot | `streambot-subtitle-languages`, `streambot-subtitles-include-auto-generated`                                                                                                                                                                                    | String/Boolean; process snapshot                            | `src/config/schema.ts`                           |
| Streambot | `streambot-reconnect-enabled`, `streambot-reconnect-delay-seconds`, `streambot-reconnect-max-attempts`                                                                                                                                                          | Boolean/Number; process snapshot                            | `src/config/schema.ts`                           |
| Streambot | `streambot-player-card-tick-ms`, `streambot-player-card-repost-after-messages`, `streambot-idle-timeout-seconds`, `streambot-playlist-limit`, `streambot-live-buffer-ms`                                                                                        | Number; process snapshot                                    | `src/config/schema.ts`                           |
| Streambot | `streambot-music-over-voice-enabled`                                                                                                                                                                                                                            | Boolean; per-guild/user gate                                | `src/config/media-features.ts`                   |
| Streambot | `streambot-sports-streaming-enabled`                                                                                                                                                                                                                            | Boolean; per-guild/user gate                                | `src/config/media-features.ts`                   |
| Scout     | `explore-guild-allowlist`, `llm-hourly-token-budget`, `llm-daily-token-budget`                                                                                                                                                                                  | String/Number; backend snapshot                             | `packages/backend/src/config/dynamic.ts`         |
| Scout     | `scout-report-ai-model`, `scout-explore-model`                                                                                                                                                                                                                  | String; backend snapshot                                    | `packages/backend/src/config/dynamic.ts`         |
| Scout     | `scout-riot-budget-mode`                                                                                                                                                                                                                                        | String (`observe`/`enforce`); read per Riot request         | `packages/backend/src/config/dynamic.ts`         |
| Scout     | `scout-evidence-recovery-enabled`                                                                                                                                                                                                                               | Boolean; pinned at backend boot; beta on, prod off          | `packages/backend/src/evidence/recovery-gate.ts` |
| Scout     | `ai_reports_enabled`, `ai_reports_unlimited`, `dares_enabled`, `debug`, `scout-consumer-player-profiles-enabled`                                                                                                                                                | Boolean; guild/user/environment context on every evaluation | `packages/backend/src/configuration/flags.ts`    |
| Scout     | `riot_account_linking_enabled`                                                                                                                                                                                                                                  | Boolean; user/stage context; beta/prod default on           | `packages/backend/src/configuration/flags.ts`    |
| Karma     | existing admin/emoji flags                                                                                                                                                                                                                                      | String; guild context                                       | `packages/starlight-karma-bot/src/config.ts`     |
| Birmel    | `birmel-daily-posts-enabled`, `birmel-persona-enabled`, `birmel-responder-enabled`, `birmel-birthdays-enabled`, `birmel-activity-tracking-enabled`, `birmel-elections-enabled`                                                                                  | Boolean; process snapshot                                   | `src/config/dynamic.ts`                          |
| Birmel    | `birmel-llm-model`, `birmel-llm-classifier-model`, `birmel-llm-memory-model`, `birmel-llm-embedding-model`, `birmel-persona-style-model`, `birmel-llm-reasoning-effort`                                                                                         | String; process snapshot                                    | `src/config/dynamic.ts`                          |
| Birmel    | `birmel-llm-max-output-tokens`, `birmel-agent-max-steps`, `birmel-agent-response-timeout-ms`, `birmel-agent-auxiliary-timeout-ms`, `birmel-responder-engagement-window-ms`, `birmel-responder-transcript-window-ms`, `birmel-responder-transcript-max-messages` | Number; process snapshot                                    | `src/config/dynamic.ts`                          |

## Redesign before migration

- Pokémon goal mode, screenshots, notifications, event notifications, command
  limits, and the web/API surface are read while booting commands or servers.
- Mario Kart leaderboard, driver feed, screenshot commands, web/API surface,
  stream settings, and encoder settings have the same lifecycle boundary.
- Birmel scheduler start/stop and schedule shape remain restart-scoped until a
  native pause/resume lifecycle exists. The daily-post product gate is safe now
  because each scheduler tick reads the cached config.

## Keep outside Flipt

- Credentials, feature-flag bootstrap variables, one-shot CLI options, and
  infrastructure shape. Runtime telemetry and operational behavior use typed
  flags; a flag cannot create a listener, worker, credential, or storage volume.
- Birmel trusted-user grants, shell/browser/repository-editor capability, and
  Streambot voice activation plus Streambot voice capture. Evaluation access
  does not authorize persisting human audio.

  Scout's voice assistant is deliberately **not** in this list. Its activation
  is `voice_assistant_enabled` and nothing else: the flag already decided which
  guilds could open a session and already tore down live ones when it flipped
  off, so the second env gate duplicated that authority without adding any.
  What justified the env var was model verification being fatal at boot; Scout
  now loads models lazily on first use and proves the asset set in its image
  build instead, so the flag can own activation outright. Production stays
  protected by `PRODUCTION_HARD_DISABLED_FLAGS` — a code-level gate Flipt
  cannot override — rather than by an environment variable. Streambot has not
  had that lifecycle work done and keeps its env gate.

- Temporal schedule enablement, TaskNotes/user-owned settings, persisted Scout
  report/sound settings, and UI query-state booleans.

## Verification boundary

Dynamic definitions are typed with Zod and resolve `flag → env → default`.
Snapshot consumers are seeded from the existing production configuration, so a
provider outage or first-read race follows the declared consumer default.
Missing declared keys and malformed successful responses fail loudly.
Per-guild and per-user Scout policy decisions pass explicit context and use
their declared defaults. Guild command reconciliation visits every connected
guild and sends an empty replacement payload when a policy is disabled,
removing stale commands.

The inventory observer publishes one-hot live configuration state and scoped
exception metadata. Consumer metrics separately report evaluations, readiness,
snapshot age, and configured Flipt identity. Configured ON is not live acceptance.
The [operator how-to](../docs/wiki/src/content/docs/how-to/check-flipt-flag-inventory.md)
describes explicit, revision-guarded changes to existing booleans. Scheduled
reconciliation creates missing declarations and never overwrites targeting.
