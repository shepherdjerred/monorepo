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
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code subscription token. Auth for every `claude -p` activity (currently pr-agent + homelab-audit).
- `ANTHROPIC_API_KEY` — direct Anthropic API key. Used by the SDK-native `runPrSummaryPipeline` activity (Phase 7 of the SOTA PR review bot plan). The Anthropic TypeScript SDK only accepts the direct API key, so this is required for the SDK summary path. Shadow-mode caveat: with both `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` set, the legacy `claude -p` CLI prefers the API key and bills direct credits instead of the subscription — accepted for the ~2-week shadow window; Phase 13 retires the CLI path and the conflict goes away.
- `POSTAL_HOST`, `POSTAL_API_KEY` — Postal email service
- `RECIPIENT_EMAIL`, `SENDER_EMAIL` — Email addresses for dependency summary and homelab audit
- `RUNBOOK_PATH` — local override for the homelab-audit runbook (defaults to fetching `https://raw.githubusercontent.com/.../packages/docs/guides/2026-04-04_homelab-audit-runbook.md`)
- `PAGERDUTY_TOKEN` — PagerDuty REST API token (homelab audit)
- `BUGSINK_URL`, `BUGSINK_TOKEN` — Bugsink REST API base + token (homelab audit)
- `GRAFANA_URL`, `GRAFANA_API_KEY` — Grafana base + API key (PromQL/Loki via the `/api/datasources/proxy/<id>/...` endpoints)
- `ARGOCD_SERVER`, `ARGOCD_AUTH_TOKEN` — ArgoCD server + token for `argocd app list` (homelab audit §13)
- `CLOUDFLARE_API_TOKEN` — read-only Cloudflare token used by `tofu plan -detailed-exitcode` (homelab audit §4)
- `TALOSCONFIG` — path to talosconfig (set to `/etc/talos/config` in cluster). Sourced via the projected volume that mounts 1P field `TALOSCONFIG_YAML` as a file. Marked optional in cdk8s — if the 1P field is unset, the file is absent and talosctl commands inside the audit fail fast with a clear error.
- `TELEMETRY_ENABLED`, `OTLP_ENDPOINT`, `TELEMETRY_SERVICE_NAME` — OpenTelemetry tracing → Tempo (gated by `TELEMETRY_ENABLED`)
- `SENTRY_DSN`, `ENVIRONMENT` — Sentry/Bugsink error tracking (init no-ops when DSN unset)
- `APP_METRICS_PORT` — port for the application Prometheus registry (default `9465`); separate from the SDK metrics on `:9464`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` — bot identity for any activity that runs `git commit`
- `GITHUB_WEBHOOK_SECRET` — HMAC secret used to verify `X-Hub-Signature-256` on incoming PR webhooks. **Required** when the webhook server is enabled; the server only starts when this is set.
- `GITHUB_PERSONAL_ACCESS_TOKEN` — token passed to the `github-mcp-server` MCP backend used by the pr-agent activity. May be the same as `GH_TOKEN` if the existing token has the necessary `pull_requests: read+write` and `contents: read` scopes; keep separate if you want a narrower-scoped token for the bot.
- `GITHUB_WEBHOOK_PORT` — port for the GitHub webhook receiver (default `9466`).

## Homelab audit (daily)

`runHomelabAuditWorkflow` is registered as `homelab-audit-daily` (cron `30 6 * * *` PT). It invokes `claude -p` with the runbook at `packages/docs/guides/2026-04-04_homelab-audit-runbook.md` as the prompt, then renders the agent's markdown to HTML and sends it via Postal with tag `homelab-audit`. See `packages/docs/plans/2026-05-09_daily-homelab-audit-email.md` for the design + verification ladder.

The activity (`src/activities/homelab-audit.ts`) mirrors the `pr-agent` lifecycle (Bun.spawn `claude -p`, 10 s heartbeats, stderr line pump with token redaction, parsed `--output-format json` result, Sentry capture on failure, Prom metrics).

**Local dev loop (no Temporal, no cluster)** — see `scripts/run-homelab-audit-local.ts`:

```bash
# Mac already has every CLI the prompt invokes (kubectl, talosctl, tofu via op
# run, gh). DRY_RUN=1 writes /tmp/homelab-audit-<ts>.{md,html} instead of
# POSTing to Postal.
op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts

# Section-filter for cheap iteration (no full 25-min run while tuning the prompt):
op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts --sections=1,9,13

# Cheap-model iteration:
op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts --haiku

# Real Postal send (use a +audit-test alias for filterability):
op run --env-file=.env.audit -- bun run scripts/run-homelab-audit-local.ts
```

Set `RUNBOOK_PATH=packages/docs/guides/2026-04-04_homelab-audit-runbook.md` in `.env.audit` to use the in-tree runbook (no GitHub round-trip).

**Cluster RBAC** — the worker SA gets a cluster-wide read-only `temporal-worker-audit-reader` ClusterRole (see `packages/homelab/src/cdk8s/src/resources/temporal/audit-rbac.ts`). No `pods/exec`, no write verbs.

## PR review / summary bot

Per webhook delivery, the Hono server in `src/event-bridge/github-webhook.ts` starts four workflows in parallel:

| Workflow                   | Queue        | Activity                                           | Comment marker            |
| -------------------------- | ------------ | -------------------------------------------------- | ------------------------- |
| `prReview` (legacy)        | `DEFAULT`    | `runPrAgent` (claude -p)                           | _none — posts a review_   |
| `prSummary` (legacy)       | `DEFAULT`    | `runPrAgent` (claude -p)                           | `<!-- pr-summary -->`     |
| `prReviewPipeline` (SOTA)  | `PR_REVIEW`  | multi-specialist consensus + verify                | per Phase 1 design        |
| `prSummaryPipeline` (SOTA) | `PR_SUMMARY` | `runPrSummaryPipeline` (Anthropic SDK + Haiku 4.5) | `<!-- pr-summary-sdk -->` |

The two summary paths use **distinct** markers so both comments live on every non-draft PR during shadow mode — reviewers and the eval grader compare quality side-by-side. Phase 13 retires the legacy `claude -p` workflows; at that point the SDK summary takes over the canonical `<!-- pr-summary -->` marker if useful.

The `runPrAgent` activity (`src/activities/pr-agent.ts`) launches `claude -p --mcp-config <tempfile> --allowed-tools mcp__github__* --model <m> --max-turns <n>`. The MCP config points at `/usr/local/bin/github-mcp-server` (installed in the worker image via `withGithubMcpServer` in `.dagger/src/image.ts`). Tokens are passed via env, never written into the MCP config file. stderr is streamed line-by-line through `jsonLog` with token redaction. Heartbeats fire every 10s during the subprocess lifetime.

The `runPrSummaryPipeline` activity (`src/activities/pr-review/summary.ts`) talks to the Anthropic SDK directly. Streams Haiku 4.5 via `messages.stream(...).finalMessage()`. Prompt caching pinned to the last system block (CLAUDE.md hierarchy). Cost target ≤$0.10/summary. See `scripts/replay-pr-summary.ts --pr <#>` for the verification harness.

**Component log values** (use these in `component:` and LogQL filters):

- `pr-webhook` — webhook server
- `pr-agent` — `claude -p` subprocess wrapper (legacy)
- `pr-summary` — SDK-native Haiku summary activity

**Shadow-mode auth caveat** — the worker pod has both `CLAUDE_CODE_OAUTH_TOKEN` (subscription, used by `claude -p`) and `ANTHROPIC_API_KEY` (used by the SDK summary). When both are set, the legacy CLI prefers the API key and bills direct-API credits instead of the subscription. We accept this for the ~2-week shadow window (Phase 12 of the SOTA plan); Phase 13 retires the CLI path and the conflict goes away.

**Models** — legacy review uses `claude-opus-4-7` (max-turns 30), legacy summary uses `claude-haiku-4-5-20251001` (max-turns 10), SDK summary uses `claude-haiku-4-5` via the official SDK with streaming.

## HA presence (welcomeHome / leavingHome) — debounce model

HA `state_changed` events for `person.jerred` / `person.shuxin` flap at the home/not_home boundary (GPS / wifi / cell-tower jitter). Two layers, both keyed off `PRESENCE_COOLDOWN_SECONDS = 90` in `src/shared/presence.ts`:

1. **Trigger dedupe** (`src/event-bridge/triggers.ts`) — workflow ids are `welcome-home-{cooldownBucket()}-{entity}` / `leaving-home-{cooldownBucket()}-{entity}` with `REJECT_DUPLICATE` + `WorkflowIdConflictPolicy.FAIL`. Duplicate transitions inside one 90 s tumbling window are rejected at the server and surfaced as `component=ha-presence phase=debounced`.
2. **Workflow recheck** (`src/workflows/ha/{leaving,welcome}-home.ts`) — both workflows sleep `PRESENCE_COOLDOWN_SECONDS` before any side-effect, then re-fetch presence (`everyoneAway()` / `anyoneHome()` from `./util.ts`). A single false transition exits without notifying / locking / vacuuming, logged as `phase=debounced`.

LogQL: `{namespace="temporal"} | json | component="ha-presence"`.
