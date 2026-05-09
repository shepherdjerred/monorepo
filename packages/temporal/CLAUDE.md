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

# docs-groom prompt-iteration helpers (Fix 4 from i-didn-t-see-an-wondrous-quill plan)
bun run groom:iterate-setup   # one-time: clone /tmp/groom-iterate
bun run groom:iterate         # run claude → parse → print, no Temporal involved
```

## Local dev loop (no CI, no Argo, no real GitHub)

The full deploy chain (PR → CI → image → Argo → pod) takes ~30 min per round-trip. For docs-groom and similar claude-using workflows you almost never need it — three layered local paths cover most iteration:

### A. Prompt-tuning only — no Temporal at all

When you're iterating on `GROOM_PROMPT` or the `GroomResult` schema. Calls `claude -p` directly against a fresh worktree.

```bash
bun run groom:iterate-setup       # one-time, clones /tmp/groom-iterate
# edit packages/temporal/src/shared/docs-groom-prompts.ts (or types.ts)
bun run groom:iterate             # claude runs, parsed result prints, no Temporal
cd /tmp/groom-iterate && git status -s    # what claude tried to edit inline
cd /tmp/groom-iterate && git checkout . && git clean -fd    # reset for next run
```

### B. Workflow-bundle smoke test — sub-second

`Worker.create()` webpack-bundles the workflow at startup. PR #685 shipped a transitive `@sentry/bun` import that webpack couldn't resolve (`UnhandledSchemeError: node:util`) and the worker pod crashed at boot 25 min into deploy. The new bundle test in `src/workflows/bundle.test.ts` runs the same webpack pass in ~1 s; it's part of `bun run test` now.

```bash
cd packages/temporal && bun run test       # bundle test runs alongside the rest
```

If you import an activity helper into a workflow file and this test starts failing — move the helper to `src/shared/` (a pure module with no Sentry/observability imports).

### C. Full-stack local with `DOCS_GROOM_DRY_RUN=1`

Real claude, real worker, real Temporal — but `git push` and `gh pr create` are stubbed so you can iterate end-to-end without mutating origin.

```bash
# 1. Local Temporal dev server (no in-cluster dependency)
temporal server start-dev --port 7233 &

# 2. Env from 1Password
export TEMPORAL_ADDRESS=localhost:7233
export DOCS_GROOM_DRY_RUN=1
export GH_TOKEN=$(op read 'op://Homelab (Kubernetes)/temporal-worker-secrets/GH_TOKEN')
export ANTHROPIC_API_KEY=$(op read 'op://Homelab (Kubernetes)/temporal-worker-secrets/ANTHROPIC_API_KEY')
export CLAUDE_CODE_OAUTH_TOKEN=$(op read 'op://Homelab (Kubernetes)/temporal-worker-secrets/CLAUDE_CODE_OAUTH_TOKEN')

# 3. Run the worker locally
cd packages/temporal && bun run start

# 4. From another shell — trigger
temporal --address localhost:7233 schedule trigger --schedule-id docs-groom-daily

# 5. Iterate. Restart worker after activity edits.
```

The dry-run mode keeps these LIVE (still hits the real thing):

- `git clone` (read-only, public repo)
- `claude -p` (real Anthropic API spend)
- Local git ops, typecheck, validation

…and skips these:

- `git push --force-with-lease origin <branch>` (logs `[dry-run] would push <branch>`)
- `gh pr create --draft` (logs `[dry-run] would create draft PR` with the rendered body, returns a fake URL)

**Warnings:**

- **Don't forget `DOCS_GROOM_DRY_RUN=1`** — without it, claude's edits get pushed to GitHub from your laptop.
- **Real-claude tokens spend** — even in dry-run, `claude -p` hits the real Anthropic API. Add `--max-budget-usd` to the activity if iterating heavily.
- **Don't leave the in-cluster worker scaled to 0 by accident** — if you want to reuse the in-cluster Temporal instead of `start-dev`, port-forward (`kubectl port-forward -n temporal svc/temporal-temporal-server-service 7233:7233`) and scale the in-cluster worker down (`kubectl scale deployment -n temporal temporal-temporal-worker --replicas=0`) so it doesn't compete for tasks. **Restore it after** (`--replicas=1`) or scheduled fires (golink-sync every 5 min, etc.) won't be processed.

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
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code subscription token. **Sole** auth for every `claude -p` activity (docs-groom + pr-agent). The cdk8s deployment intentionally does NOT inject `ANTHROPIC_API_KEY` — when both are present the CLI prefers the API key, which billed against direct-API credits instead of the subscription. The 1P field still exists for emergency fallback but is not referenced.
- `POSTAL_HOST`, `POSTAL_API_KEY` — Postal email service
- `RECIPIENT_EMAIL`, `SENDER_EMAIL` — Email addresses for dependency summary
- `TELEMETRY_ENABLED`, `OTLP_ENDPOINT`, `TELEMETRY_SERVICE_NAME` — OpenTelemetry tracing → Tempo (gated by `TELEMETRY_ENABLED`)
- `SENTRY_DSN`, `ENVIRONMENT` — Sentry/Bugsink error tracking (init no-ops when DSN unset)
- `APP_METRICS_PORT` — port for the application Prometheus registry (default `9465`); separate from the SDK metrics on `:9464`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` — bot identity for `git commit` in docs-groom
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
