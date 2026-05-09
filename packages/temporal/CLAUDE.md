# packages/temporal

Temporal workflow worker for the monorepo. Consolidates ad-hoc scheduling (K8s CronJobs, in-process cron, custom job queues) under Temporal for durability, observability, and unified scheduling.

## Runtime

Runs under **Bun**. The Temporal TypeScript SDK supports Bun for workers, workflows, activities, and client.

## Structure

```
src/
  worker.ts              # Worker entrypoint — connects to Temporal server, registers task queues
  client.ts              # Shared Temporal client factory (reusable by other packages)
  shared/
    task-queues.ts       # Task queue name constants
    schemas.ts           # Zod schemas for workflow inputs
  workflows/             # Temporal workflow definitions (deterministic, no I/O)
  activities/            # Temporal activity implementations (actual work: API calls, DB, etc.)
  schedules/
    register-schedules.ts  # Creates/updates all Temporal schedules on worker startup
```

## Key Concepts

- **Workflows** are deterministic functions. No direct I/O — call activities instead.
- **Activities** do the real work (HTTP calls, DB queries, file I/O). They run outside the sandbox.
- **Schedules** replace K8s CronJobs — managed by Temporal, visible in the UI.

## Commands

```bash
bun run start        # Start worker (connects to Temporal server)
bun run typecheck    # Type check (runs ensure-ha-schema first)
bun run lint         # ESLint
bun test             # Run tests (incl. workflow-bundle smoke test)
bun run generate     # Regenerate src/generated/ha-schema.ts from live HA (needs HA_URL + HA_TOKEN)
```

The `bun test` run includes a workflow-bundle smoke test (`src/workflows/bundle.test.ts`) that runs the same webpack pass `Worker.create()` performs at startup. If you import an activity helper into a workflow file and this test starts failing, move the helper to `src/shared/` (a pure module with no Sentry/observability imports).

## HA schema (type-safe workflows)

Workflows that touch Home Assistant go through `src/workflows/ha/util.ts`, which wraps each activity in a schema-parameterized signature — entity IDs, domains, services, and service data are type-checked against `src/generated/ha-schema.ts`.

That file is **gitignored** (`packages/temporal/.gitignore`). It is produced by `@shepherdjerred/home-assistant`'s `ha-codegen` CLI and contains entity IDs / service definitions from the live HA instance, which is treated as sensitive (see the `HA types are sensitive, generate in CI` auto-memory).

Two committed artifacts make this work without always needing HA credentials:

- `src/generated/ha-schema.stub.ts` — a permissive `DefaultHaSchema` fallback. No sensitive content.
- `scripts/ensure-ha-schema.ts` — pre-script that copies the stub into `ha-schema.ts` when the generated file is missing. Invoked automatically by `bun run typecheck`, `bun test`, and `bun run build`.

Workflow:

- **Local dev with HA access**: `bun run generate` populates `ha-schema.ts` with real data. Workflows get strict type safety. Don't commit the result.
- **Local dev without HA access**: stub flows in automatically via `ensure-ha-schema.ts`. Workflows typecheck against `DefaultHaSchema` (loose strings). Same compile behavior as before this feature landed.
- **CI (Dagger)**: today runs against the stub. To get strict typing in CI, add a `generateAndTypecheck` variant in `.dagger/src/typescript.ts` that injects `HA_URL` + `HA_TOKEN` via `withSecretVariable`, and register temporal in the codegen-required packages set (`scripts/ci/src/catalog.ts`'s `PRISMA_PACKAGES` is the analogous place). Not wired yet — the stub keeps CI green.

## Environment Variables

- `TEMPORAL_ADDRESS` — Temporal server gRPC address (default: `temporal-server.temporal.svc.cluster.local:7233`)
- `HA_URL` — Home Assistant URL
- `HA_TOKEN` — Home Assistant long-lived access token
- `GOLINK_URL` — Golink service URL
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` — S3/SeaweedFS credentials
- `GH_TOKEN` — GitHub API token (used by activities that clone repos or call the GitHub API)
- `OPENAI_API_KEY` — OpenAI API key
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code subscription token. **Sole** auth for every `claude -p` activity (currently pr-agent). The cdk8s deployment intentionally does NOT inject `ANTHROPIC_API_KEY` — when both are present the CLI prefers the API key, which billed against direct-API credits instead of the subscription. The 1P field still exists for emergency fallback but is not referenced.
- `POSTAL_HOST`, `POSTAL_API_KEY` — Postal email service
- `RECIPIENT_EMAIL`, `SENDER_EMAIL` — Email addresses for dependency summary
- `TELEMETRY_ENABLED`, `OTLP_ENDPOINT`, `TELEMETRY_SERVICE_NAME` — OpenTelemetry tracing → Tempo (gated by `TELEMETRY_ENABLED`)
- `SENTRY_DSN`, `ENVIRONMENT` — Sentry/Bugsink error tracking (init no-ops when DSN unset)
- `APP_METRICS_PORT` — port for the application Prometheus registry (default `9465`); separate from the SDK metrics on `:9464`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` — bot identity for any activity that runs `git commit`
- `GITHUB_WEBHOOK_SECRET` — HMAC secret used to verify `X-Hub-Signature-256` on incoming PR webhooks. **Required** when the webhook server is enabled; the server only starts when this is set.
- `GITHUB_PERSONAL_ACCESS_TOKEN` — token passed to the `github-mcp-server` MCP backend used by the pr-agent activity. May be the same as `GH_TOKEN` if the existing token has the necessary `pull_requests: read+write` and `contents: read` scopes; keep separate if you want a narrower-scoped token for the bot.
- `GITHUB_WEBHOOK_PORT` — port for the GitHub webhook receiver (default `9466`).

## PR review / summary bot

`prReview` and `prSummary` workflows are triggered by GitHub `pull_request` webhook deliveries. The Hono server in `src/event-bridge/github-webhook.ts` runs alongside the HA WebSocket listener, verifies the signature, skips draft + bot-authored PRs, and starts both workflows in parallel with workflow IDs `pr-{kind}-{owner}-{repo}-{prNumber}-{commitSha}` (`WorkflowIdReusePolicy.ALLOW_DUPLICATE`).

The `runPrAgent` activity (`src/activities/pr-agent.ts`) launches `claude -p --mcp-config <tempfile> --allowed-tools mcp__github__* --model <m> --max-turns <n>`. The MCP config points at `/usr/local/bin/github-mcp-server` (installed in the worker image via `withGithubMcpServer` in `.dagger/src/image.ts`). Tokens are passed via env, never written into the MCP config file. stderr is streamed line-by-line through `jsonLog` with token redaction. Heartbeats fire every 10s during the subprocess lifetime.

**Component log values** (use these in `component:` and LogQL filters):

- `pr-webhook` — webhook server
- `pr-agent` — `claude -p` subprocess wrapper

**Models** — review uses `claude-opus-4-7` (max-turns 30), summary uses `claude-haiku-4-5-20251001` (max-turns 10). Summary comments include the marker `<!-- pr-summary -->` so subsequent runs edit in place instead of duplicating.

## HA presence (welcomeHome / leavingHome) — debounce model

HA `state_changed` events for `person.jerred` / `person.shuxin` flap at the home/not_home boundary (GPS / wifi / cell-tower jitter). Two layers, both keyed off `PRESENCE_COOLDOWN_SECONDS = 90` in `src/shared/presence.ts`:

1. **Trigger dedupe** (`src/event-bridge/triggers.ts`) — workflow ids are `welcome-home-{cooldownBucket()}-{entity}` / `leaving-home-{cooldownBucket()}-{entity}` with `REJECT_DUPLICATE` + `WorkflowIdConflictPolicy.FAIL`. Duplicate transitions inside one 90 s tumbling window are rejected at the server and surfaced as `component=ha-presence phase=debounced`.
2. **Workflow recheck** (`src/workflows/ha/{leaving,welcome}-home.ts`) — both workflows sleep `PRESENCE_COOLDOWN_SECONDS` before any side-effect, then re-fetch presence (`everyoneAway()` / `anyoneHome()` from `./util.ts`). A single false transition exits without notifying / locking / vacuuming, logged as `phase=debounced`.

LogQL: `{namespace="temporal"} | json | component="ha-presence"`.
