# Monorepo feature-flag inventory

The language-neutral [managed inventory](src/managed-flag-inventory.json) owns
flag names, types, targeting, environment overrides, and default-off exceptions.
[Active deployments](src/deployments.ts) project that inventory onto one
`<catalog>/<stage>` document per workload reader (`scout/beta`, `scout/prod`,
`streambot/prod`, `minecraft/tsmc`, `storm/prod`, and the other hosted
services). New boolean features default on in production and beta. A non-global
rollout requires an environment-scoped reason, `AI` issue, enablement criteria,
and either a `reviewBy` date or `noDeployedConsumer: true` (when an environment
has no deployed consumer) in `defaultOffExceptions`. A deferred owner decision
is recorded as such.

## Dynamic consumers

Streambot's `streambot-web-ui-enabled` gate is evaluated per server and user on
every authenticated media request in `src/config/media-features.ts`. It defaults
on in production. Web credential and listener bootstrap stay outside Flags.

Web remote music search reads the variant `streambot-music-search-provider`
(`youtube-music` or `musicbrainz`) per request in `src/config/media-features.ts`.
The code default and the inventory declaration are both `youtube-music` for
production and beta; an unknown value throws instead of falling back.

Competitive LoL uses `streambot-lol-esports-enabled` for official schedules and
broadcasts, and `streambot-lol-autoplay-enabled` for one-time automatic playback.
Both are Boolean gates evaluated per server/user and default on in production.
They also require `streambot-sports-streaming-enabled`.
Scheduler credentials and the internal listener are bootstrap, outside Flags.
Streambot and The Storm run one deployed service each and project only their
active deployments (`streambot/prod`, `minecraft/tsmc`, and `storm/prod`) rather
than storing unread beta documents.

The Scout Client flags have no code-level production denial; Flags decides.
Scout's `packages/backend/src/scout-client/access/policy.ts` first asks
whether a flag answers true for the rollout's first audience (the owner's
account and the owner's server segment), with no database read, so
production's managed `false` closes every client path. Per device it
then evaluates the owner with `{ user }`, and otherwise each guild where the
owner has a `Player` with `{ server }`, so the existing `scout-guild-<id>`
segments target whole servers. Production stays off under a default-off
exception (AI-553); its owner, owner's-server and everyone steps are explicit
operator changes made on evidence.

| Consumer  | Flag keys                                                                                                                                                                                                                                                                                         | Type and targeting                                                                               | Current source                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Streambot | `player-card-enabled`, `subtitles-enabled`                                                                                                                                                                                                                                                        | Boolean; process snapshot                                                                        | `src/config/dynamic.ts`                                             |
| Streambot | `streambot-subtitle-languages`, `streambot-subtitles-include-auto-generated`                                                                                                                                                                                                                      | String/Boolean; process snapshot                                                                 | `src/config/schema.ts`                                              |
| Streambot | `streambot-reconnect-enabled`, `streambot-reconnect-delay-seconds`, `streambot-reconnect-max-attempts`                                                                                                                                                                                            | Boolean/Number; process snapshot                                                                 | `src/config/schema.ts`                                              |
| Streambot | `streambot-usage-analytics-enabled`                                                                                                                                                                                                                                                               | Boolean; process snapshot                                                                        | `src/config/dynamic.ts`                                             |
| Streambot | `streambot-player-card-tick-ms`, `streambot-player-card-repost-after-messages`, `streambot-idle-timeout-seconds`, `streambot-playlist-limit`, `streambot-live-buffer-ms`                                                                                                                          | Number; process snapshot                                                                         | `src/config/schema.ts`                                              |
| Streambot | `streambot-music-over-voice-enabled`                                                                                                                                                                                                                                                              | Boolean; per-guild/user gate                                                                     | `src/config/media-features.ts`                                      |
| Streambot | `streambot-sports-streaming-enabled`                                                                                                                                                                                                                                                              | Boolean; per-guild/user gate                                                                     | `src/config/media-features.ts`                                      |
| Streambot | `streambot-music-search-provider`                                                                                                                                                                                                                                                                 | String; per-request, per-guild/user                                                              | `src/config/media-features.ts`                                      |
| Streambot | `streambot-voice-decisions-router-enabled`                                                                                                                                                                                                                                                        | Boolean; per-guild/user gate                                                                     | `src/config/media-features.ts`                                      |
| Scout     | `explore-guild-allowlist`, `llm-hourly-token-budget`, `llm-daily-token-budget`                                                                                                                                                                                                                    | String/Number; backend snapshot                                                                  | `packages/backend/src/config/dynamic.ts`                            |
| Scout     | `scout-report-ai-model`, `scout-explore-model`                                                                                                                                                                                                                                                    | String; backend snapshot                                                                         | `packages/backend/src/config/dynamic.ts`                            |
| Scout     | `scout-riot-budget-mode`                                                                                                                                                                                                                                                                          | String (`observe`/`enforce`); read per Riot request                                              | `packages/backend/src/config/dynamic.ts`                            |
| Scout     | `scout-evidence-recovery-enabled`                                                                                                                                                                                                                                                                 | Boolean; pinned at backend boot; beta on, prod off                                               | `packages/backend/src/evidence/recovery-gate.ts`                    |
| Scout     | `scout-participant-crawl-enabled`, `scout-participant-crawl-daily-match-budget`                                                                                                                                                                                                                   | Boolean (default off; beta on, prod off and hard-disabled in code) / Number; read per crawl tick | `packages/backend/src/league/crawl/crawl-activity.ts`               |
| Scout     | `scout-rank-refresh-enabled`                                                                                                                                                                                                                                                                      | Boolean (default off; beta on, prod off); read per refresh batch                                 | `packages/backend/src/league/rank-refresh/rank-refresh-activity.ts` |
| Scout     | `ai_reports_enabled`, `ai_reports_unlimited`, `dares_enabled`, `debug`, `scout-consumer-player-profiles-enabled`                                                                                                                                                                                  | Boolean; guild/user/environment context on every evaluation                                      | `packages/backend/src/configuration/flags.ts`                       |
| Scout     | `riot_account_linking_enabled`                                                                                                                                                                                                                                                                    | Boolean; user/stage context; beta/prod default on                                                | `packages/backend/src/configuration/flags.ts`                       |
| Scout     | `scout_client_ingestion`, `scout_client_result_recovery`                                                                                                                                                                                                                                          | Boolean; owner user, then owner's guilds; beta on, prod off                                      | `packages/backend/src/scout-client/access/policy.ts`                |
| Scout     | `scout_desktop_explore_enabled`                                                                                                                                                                                                                                                                   | Boolean; owner user, then owner's Explore servers; beta/prod default on                          | `packages/backend/src/scout-client/desktop/auth.ts`                 |
| Scout     | `scout_desktop_coach`, `scout_coach_live_answers`, `scout_desktop_voice`                                                                                                                                                                                                                          | Boolean; owner user, then owner's Explore servers; beta/prod default on                          | `packages/backend/src/coach/context-policy.ts`                      |
| Scout     | `scout_coach_proactive`                                                                                                                                                                                                                                                                           | Boolean; owner, then Explore servers; beta on, prod hard-disabled in code (AI-558)               | `packages/backend/src/coach/proactive-policy.ts`                    |
| Scout     | `scout-client-minimum-version`                                                                                                                                                                                                                                                                    | String (semver); read per check-in and batch                                                     | `packages/backend/src/config/dynamic.ts`                            |
| Karma     | existing admin/emoji flags                                                                                                                                                                                                                                                                        | String; guild context                                                                            | `packages/starlight-karma-bot/src/config.ts`                        |
| Birmel    | `birmel-daily-posts-enabled`, `birmel-persona-enabled`, `birmel-responder-enabled`, `birmel-birthdays-enabled`, `birmel-activity-tracking-enabled`, `birmel-elections-enabled`, `birmel-llm-decisions-enabled`                                                                                    | Boolean; process snapshot                                                                        | `src/config/dynamic.ts`                                             |
| Birmel    | `birmel-llm-model`, `birmel-llm-classifier-model`, `birmel-llm-decisions-model`, `birmel-llm-memory-model`, `birmel-llm-embedding-model`, `birmel-persona-style-model`, `birmel-llm-reasoning-effort`                                                                                             | String; process snapshot                                                                         | `src/config/dynamic.ts`                                             |
| Birmel    | `birmel-llm-decisions-threshold`, `birmel-llm-max-output-tokens`, `birmel-agent-max-steps`, `birmel-agent-response-timeout-ms`, `birmel-agent-auxiliary-timeout-ms`, `birmel-responder-engagement-window-ms`, `birmel-responder-transcript-window-ms`, `birmel-responder-transcript-max-messages` | Number; process snapshot                                                                         | `src/config/dynamic.ts`                                             |
| Golink    | `golink-dynamic-aliases-enabled`, `golink-writes-enabled`, `golink-telemetry-enabled`                                                                                                                                                                                                             | Boolean; per-request alias/write gates and startup tracing gate; beta/prod default on            | `packages/golink/src/config/flags.ts`                               |

## Redesign before migration

- Pokémon goal mode, screenshots, notifications, event notifications, command
  limits, and the web/API surface are read while booting commands or servers.
- Mario Kart leaderboard, driver feed, screenshot commands, web/API surface,
  stream settings, and encoder settings have the same lifecycle boundary.
- Birmel scheduler start/stop and schedule shape remain restart-scoped until a
  native pause/resume lifecycle exists. The daily-post product gate is safe now
  because each scheduler tick reads the cached config.

## Keep outside Flags

- Credentials, feature-flag bootstrap variables (`FEATURE_FLAGS_MODE`,
  `FLAGS_URL`, `FLAGS_DEPLOYMENT`), one-shot CLI options, and infrastructure
  shape. Runtime telemetry and operational behavior use typed flags; a flag
  cannot create a listener, worker, credential, or storage volume.
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
  protected by `PRODUCTION_HARD_DISABLED_FLAGS` — a code-level gate Flags
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
exception metadata across active Flags deployments. Consumer metrics separately
report evaluations, readiness, snapshot age, and configured deployment identity.
Configured ON is not live acceptance. The
[operator how-to](../docs/wiki/src/content/docs/how-to/check-flag-inventory.md)
describes `toolkit flags`, the browser UI, and explicit revision-checked changes
to existing flags. Scheduled reconciliation creates missing declarations via
`create-missing` and never overwrites targeting.
