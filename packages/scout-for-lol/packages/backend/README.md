# Scout Backend

The Scout for LoL backend service. A single Bun process that runs:

- The Discord bot (Discord.js): slash commands, match notifications, report delivery
- Match polling cron jobs through Scout's native Riot API client, with raw match JSON archived to S3
- The tRPC/HTTP server that the web app SPA (`@scout-for-lol/app`) and desktop client call
- The DuckDB "report lake" (Parquet, derived from S3) that executes ScoutQL report queries
- Server-side product analytics (PostHog) and metrics (Prometheus) / error tracking (Sentry)

Application state (subscriptions, competitions, guilds) is PostgreSQL 16
managed by Prisma (`@prisma/adapter-pg`). Report images are rendered by
`@scout-for-lol/report`.

## Commands

```bash
bun run dev              # Start with hot reload
bun run start            # Start once
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

## Configuration

Environment variables are validated with `env-var`/Zod at startup. Discord and
Riot API tokens are required; in test mode (`NODE_ENV=test`) placeholder values
are used automatically. For a full local backend + web app, use
`bun run dev:web` from the Scout package root (secrets via 1Password). Local
`dev:web` does not own the BETA Discord gateway unless you pass
`--discord-gateway`.

See the [report-lake explanation](../../../docs/wiki/src/content/docs/explanation/scout-report-lake.md)
and the parent [README](../../README.md) for architecture. The parent
[AGENTS.md](../../AGENTS.md) contains only always-on product and delivery
constraints.
