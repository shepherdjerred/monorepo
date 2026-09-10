# Scout Backend

The Scout for LoL backend service. One Bun image that runs:

- The Discord bot (Discord.js): slash commands, match notifications, report delivery
- Match polling cron jobs through Scout's native Riot API client, with raw match JSON archived to S3
- The tRPC/HTTP server that the web app SPA (`@scout-for-lol/app`) and desktop client call
- The DuckDB "report lake" (Parquet, derived from S3) that executes ScoutQL report queries
- Server-side product analytics (PostHog) and metrics (Prometheus) / error tracking (Sentry)

One image, but not necessarily one process: see [Runtime roles](#runtime-roles).

Application state (subscriptions, competitions, guilds) is PostgreSQL 16
managed by Prisma (`@prisma/adapter-pg`). Report images are rendered by
`@scout-for-lol/report`.

## Commands

```bash
bun run dev              # Start with hot reload
bun run start            # Start once (the `combined` role)
bun run start:application    # Web surface, interactive + lake workers, report lake
bun run start:gateway        # Discord gateway, commands, voice
bun run start:activity-worker  # Realtime + background activity workers
bun run build            # Bundle to dist/

bun run test             # bun test; each test clones a hash-scoped template database
bun run typecheck        # tsc --noEmit
bun run lint             # ESLint
bun run format           # Prettier check

bun run db:generate      # Generate the Prisma client (+ branded types)
bun run db:push          # Push schema to the shared local dev Postgres (development)
bun run db:migrate       # Create/apply migrations (prisma migrate dev)
bun run db:studio        # Open Prisma Studio

bun run docker:build     # Build the backend Docker image (repo-root context)
bun run smoke            # Smoke-test the built image
bun run compact:report-lake  # Manually fold/rebuild the DuckDB report lake
```

### Durable Temporal work

Detached prediction and parlay work is inserted once before its Temporal
workflow starts. Reconciliation starts only never-accepted `queued` rows.
After Temporal exhausts the activity's four-attempt budget, the row remains
terminal `failed`; normal producers cannot restart the same work ID.

An operator may explicitly requeue one reviewed failed row. The command is a
dry run unless `--confirm` is supplied, requires a reason, and atomically
records the reason and increments the row's requeue count:

```bash
bun run temporal:requeue-work -- \
  --work-id parlay:<match-id> \
  --reason "OpenRouter capacity restored and this match was reviewed"
```

`db:generate` must run after schema changes and before typecheck/test; from the
Scout root, `mise run generate` does the same thing.

## Beta Customs operations

Scout Customs reuses this process's Discord gateway client, OAuth client
secret, JWT signing secret, Tournament lobby service, Match-V5 cursor, and S3
ingest boundary. It has no second bot, callback result mutation, or manual
winner endpoint.

Before enabling `custom_nights_enabled`, configure the existing beta Discord
Activity at `/customs/`, grant the beta install Manage Channels and Move
Members, and persist the live Tournament registration:

```bash
bun run scripts/register-tournament-provider.ts \
  --mode=live \
  --region=AMERICA_NORTH
```

Keep `tournament_lobbies_enabled` off until `/lobby create` proves the Riot key
can create a real code. Production hard-disables both flags and its site
archive rejects any `/customs/index.html` artifact.

The beta `custom-nights-expiry` Temporal schedule closes unfinished nights
after their 12-hour database deadline, writes an audit event, and releases the
active-night pointer. It does not verify a game or synthesize a Riot result.

The scoped privacy command refuses an active night or pending voice work:

```bash
bun run customs:anonymize -- \
  --guild-id <guild-id> \
  --discord-id <participant-id> \
  --operator-id <operator-id> \
  --confirm yes
```

## Hey Scout voice assistant (beta)

`src/voice-assistant/` binds the shared `@shepherdjerred/voice-assistant`
pipeline (wake-word cascade → one OpenAI Realtime turn per question) to the
Discord bot. `/scout join` starts a per-guild session in the requester's voice
channel; grounded answers come from read-only tools over the committed data
package assets (`lookup_ability`, `lookup_champion`, `lookup_item`,
`lookup_patch_notes`). Sessions end on `/scout leave`, after 45 minutes
without an accepted wake, when the channel holds no non-bot members, or on
connection loss. No transcript text or audio is ever persisted; PostHog gets
only guild identity, outcome, the resolved champion/slot, and latency.

Two independent gates:

- **Deployment (env, bootstrap-only)**: `VOICE_ASSISTANT_ENABLED` (default
  `false`), `OPENAI_API_KEY` (required when enabled), `VOICE_ASSETS_DIR`
  (default `/opt/scout/voice`), `VOICE_KWS_RUNTIME` (`auto`/`native`/`wasm`).
  When enabled, SHA-pinned model verification is fatal at boot — this gate can
  never live in Flipt, because unauthenticated Flipt must not control audio
  capture. Asset filenames are the manifest in
  `src/voice-assistant/constants.ts`.
- **Guild (flag)**: `voice_assistant_enabled` — beta-only
  (production-hard-disabled); it also decides where the `/scout join`/`leave`
  subcommands register.

The guild `/scout` command is a per-guild merge: `ask` follows the Explore
allowlist, `join`/`leave` follow the voice flag
(`discord/commands/definitions.ts`). `VoiceManager` connections carry a mode:
assistant sessions are undeafened and are never displaced by sound-engine
alerts (alerts duck under assistant speech instead).

Manual end-to-end probe (macOS, trained assets + `OPENAI_API_KEY` required, no
Discord): `bun scripts/smoke/voice-probe.ts --list-devices`, then
`bun scripts/smoke/voice-probe.ts --device <index> --assets-dir <path>`.

## How web requests read Discord

No HTTP, tRPC, or Discord Activity request reads the gateway client's guild
cache. That cache cannot answer honestly on a request path — an unconnected or
still-backfilling client looks exactly like "Scout is not installed there" —
so web-serving code goes through two application ports instead, and a pod that
never connects a gateway serves the same answers as one that did:

- `lib/discord/installed-guilds.ts` answers "is Scout installed here?" from
  `GuildInstall` rows with `removedAt: null`. This makes `GuildInstall` an
  authorization source, not just an analytics table: its writers
  (`discord/events/guild-create.ts`, `guild-delete.ts`,
  `analytics/guild-lifecycle.ts`) are load-bearing for access control. Because a
  missing row is not proof of absence, a negative from the table is confirmed
  against Discord before it is believed.
- `lib/discord/bot-rest.ts` performs the authoritative bot-token REST reads the
  web needs — guild channels, roles, a single member, member search, user
  profiles — behind bounded per-guild TTL caches. Channel permission filtering
  is recomputed from roles and overwrites in `lib/discord/channel-permissions.ts`
  rather than read from a cached `GuildMember`.

Three outcomes stay distinct on every path: Discord unreachable
(`SERVICE_UNAVAILABLE`, or 503 on the Activity surface), Scout not installed
(`NOT_FOUND` / 403), and the caller not authorized (`FORBIDDEN`). Failing to
reach Discord must never be reported as either of the other two;
`trpc/discord-upstream.ts` and `customs/activity-auth.ts` enforce that.

Gateway events still _write_ installation state. Two background paths that used
to _read_ the gateway cache now use the same install port, because they run as
Temporal Activities that a split deployment executes with no shard at all:
weekly leaderboard delivery (`betting/weekly/weekly-leaderboard.ts`) and
scheduled report dispatch (`reports/discord-dispatcher.ts`). The consumer and
Explore eligibility check (`consumer/access.ts`) uses it too.

One gateway-cache read is deliberately left: `discord/utils/guild-membership.ts`
`getActiveServerIds()`, which narrows player polling to live guilds. It fails
open (an absent cache means "no filter", so polling widens rather than skipping
work), and the `GuildInstall` table cannot safely replace it — that table is
documented as possibly missing rows for Scout's earliest guilds, and filtering
by an incomplete set would stop polling those guilds entirely.

## Runtime roles

The image boots into one of four shapes, selected by `SCOUT_RUNTIME_ROLE`
(default `combined`). The vocabulary and the exact subsystem set per role are
one table in `configuration/runtime-role.ts`; `runtime/plan.ts` derives the boot
and shutdown order from it, and `runtime/subsystems.ts` performs the steps. An
unrecognised value throws at startup rather than falling back.

| Subsystem                                        | `combined`                                                                     | `application`               | `gateway`          | `activity-worker`    |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------- | ------------------ | -------------------- |
| Champion asset verification                      | yes                                                                            | yes                         | yes                | yes                  |
| Voice assistant (Hey Scout)                      | yes                                                                            | —                           | yes                | —                    |
| Report-lake fold at boot                         | yes                                                                            | yes                         | —                  | —                    |
| Temporal workers                                 | workflow, interactive, lake (+ realtime, background once the gateway is ready) | workflow, interactive, lake | none (client only) | realtime, background |
| Discord gateway login, commands, guild lifecycle | yes                                                                            | —                           | yes                | —                    |
| Discord REST                                     | yes                                                                            | yes                         | yes                | yes                  |
| HTTP surface                                     | full                                                                           | full                        | health + metrics   | health + metrics     |
| Competition activity worker                      | yes                                                                            | —                           | —                  | yes                  |
| Database-sweeping metric collectors              | yes                                                                            | yes                         | —                  | —                    |
| Season / freshness-gauge seeding                 | yes                                                                            | yes                         | —                  | —                    |

Notes that are easy to get wrong:

- **`combined` is what Kubernetes runs.** The other three exist so the
  deployment can be split; splitting it is a separate change. `combined` boots
  and drains in exactly the order it always has, and the role tests assert that.
- **Voice is gateway-coupled by design.** It reads an active voice connection's
  audio, so it cannot be moved off the shard. That makes `gateway` an explicitly
  stateful role.
- **`application` owns the report-lake volume** and the collectors that sweep
  the database on every `/metrics` scrape. Every role serves `/metrics`, but
  running those four collectors on all of them would turn one Prometheus scrape
  interval into N full sweeps of the same tables.
- **`application` does not wait for a shard.** The old Discord-before-HTTP
  ordering existed because web code read the guild cache; it goes through the
  ports above now, and this role has no gateway to wait for.
- **A gatewayless role marks its gateway `disabled` at boot.** The health
  singleton starts at `connecting`, and `/livez` fails a pod whose shard never
  acknowledged a heartbeat once the five-minute startup grace period ends — so
  skipping the login without saying so is a crash loop, not a missing feature.
- **`gateway` runs a Temporal client with no workers.** Commands start Workflows
  they do not execute.
- **`scout_temporal_workers`** reports 0 rather than going absent for a queue
  class this role does not run, and `/healthz` reports the running queue classes
  by name.
- The externally deployed stable/candidate Workflow Workers
  (`temporal/workflow-worker.ts`) are unaffected by any of this.

## Configuration

Environment variables are validated with `env-var`/Zod at startup. Discord and
Riot API tokens are required; in test mode (`NODE_ENV=test`) placeholder values
are used automatically. For a full local backend + web app, use
`bun run dev:web` from the Scout package root (secrets via 1Password). Local
`dev:web` does not own the BETA Discord gateway unless you pass
`--discord-gateway`: without it the backend runs the `application` role.
`--no-background-jobs` now sets only `SCOUT_DEV_SKIP_REPORT_LAKE_FOLD`, a
dev-only switch for the one boot step a laptop with no published lake build and
no S3 bucket cannot complete; it is rejected outside `ENVIRONMENT=dev`.

See the [report-lake explanation](../../../docs/wiki/src/content/docs/explanation/scout-report-lake.md)
and the parent [README](../../README.md) for architecture. The parent
[AGENTS.md](../../AGENTS.md) contains only always-on product and delivery
constraints.
