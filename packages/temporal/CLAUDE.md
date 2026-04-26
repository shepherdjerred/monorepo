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
bun test             # Run tests
bun run generate     # Regenerate src/generated/ha-schema.ts from live HA (needs HA_URL + HA_TOKEN)
```

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
- `GH_TOKEN` — GitHub API token (used by docs-groom for cloning + opening PRs)
- `OPENAI_API_KEY` — OpenAI API key
- `ANTHROPIC_API_KEY` — Anthropic API key (used by docs-groom for `claude -p`)
- `POSTAL_HOST`, `POSTAL_API_KEY` — Postal email service
- `RECIPIENT_EMAIL`, `SENDER_EMAIL` — Email addresses for dependency summary
- `TELEMETRY_ENABLED`, `OTLP_ENDPOINT`, `TELEMETRY_SERVICE_NAME` — OpenTelemetry tracing → Tempo (gated by `TELEMETRY_ENABLED`)
- `SENTRY_DSN`, `ENVIRONMENT` — Sentry/Bugsink error tracking (init no-ops when DSN unset)
- `APP_METRICS_PORT` — port for the application Prometheus registry (default `9465`); separate from the SDK metrics on `:9464`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` — bot identity for `git commit` in docs-groom

## Daily docs-groom workflow

`runDocsGroomAudit` runs daily at 06:30 PT (`30 6 * * *`, schedule id `docs-groom-daily`). It:

1. Clones a fresh shallow worktree of `shepherdjerred/monorepo` into `/tmp/groom-<wfRunId>`
2. Runs `claude -p GROOM_PROMPT --output-format json` over `packages/docs/`. Claude does small in-place edits (move stale → archive, add `## Status`, fix links, update `index.md`) AND returns a JSON list of larger improvement tasks
3. Commits any inline grooming as a single draft PR labelled `docs-groom`
4. For up to 5 easy/medium tasks (after `filterAlreadyOpen` drops slugs that already have an open or recently-closed PR), spawns one `runDocsGroomTask` child workflow per task
5. Each child does the same prepare → claude -p → validate → typecheck → push → draft PR loop, but with `IMPLEMENT_PROMPT` and one specific task. Child PRs are labelled `docs-groom` + `docs-groom-task`
6. Hard tasks are returned in the parent workflow result for visibility in the Temporal UI — no PR

**Safety:** `validateChanges` rejects empty diffs, paths matching `.env*`/`*.key`/`*.pem`/`id_rsa*`, gitignored paths, and any branch other than the expected feature branch. `typecheckIfCodeTouched` runs `bun run typecheck` for any owning workspace package whose files were changed (failure → no PR). All PRs are draft; nothing auto-merges.

**Observability** — see `src/observability/`:

- All activities emit `console.warn(JSON.stringify({ level, msg, component, module: "docs-groom", phase, workflowId, runId, traceId, ... }))` for Loki
- 8 `docs_groom_*` Prometheus metrics on `:9465`: runs, tasks-identified, prs-opened, claude duration/cost/tokens, validation rejections, filtered-already-open
- OTel spans `docs-groom.*` per activity → Tempo
- Sentry context attached per activity (workflow, phase, runId, taskSlug)
- Grafana panels: "Docs Grooming" row in `temporal-dashboard.ts`
- Alerts: `docs-groom` rule group in `monitoring/rules/temporal.ts` — schedule-not-running, activities-failing, no-prs-opened, cost-budget-exceeded, secret-rejection (critical)

LogQL examples:

```logql
{namespace="temporal"} | json | workflow=~"runDocsGroom.*"               # all docs-groom activity
{namespace="temporal"} | json | workflow=~"runDocsGroom.*" | level="error"  # failures only
{namespace="temporal"} | json | phase="validate" | reason!=""            # rejected diffs
```
