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

## Schedules (`src/schedules/register-schedules.ts`)

`registerSchedules()` upserts every entry in the `SCHEDULES` array on each worker startup
(create-or-update), deletes the explicit `DELETED_SCHEDULE_IDS` allow-list, and reconciles
pause state. The **declaration** of a schedule (its existence, cron, workflow, args, policy)
is source-controlled here; its **on/off pause state** is runtime/dynamic (see below).

### Disabling / pausing a schedule (live, no deploy)

Pause/unpause in the **Temporal Web UI** — `https://temporal-ui.tailnet-1a49.ts.net`
(Tailscale-gated) → **Schedules** → pick the schedule → **Pause**. A pause **persists across
worker restarts**: `registerSchedules` preserves live pause state on update and only ever
auto-unpauses the two env-gated `pr-review-*` schedules. This is intentional — pause is the
one dynamic knob; everything else about a schedule lives in source. Don't add a declarative
`enabled` flag, it would fight the UI.

| To stop…             | Pause schedule id(s)                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Wake-up (heat)       | `good-morning-weekday-wake`, `good-morning-weekend-wake`                                             |
| Get-up (volume ramp) | `good-morning-weekday-up`, `good-morning-weekend-up`                                                 |
| Vacuum               | `vacuum-9am`, `vacuum-12pm`, `vacuum-5pm`                                                            |
| LoL / Scout data     | `scout-data-dragon-version-check`, `scout-data-dragon-weekly-refresh`, `scout-season-refresh-weekly` |

### Catchup window (missed-run replay after a SERVER outage)

`catchupWindow` controls whether a run missed while the Temporal **server** was down gets
replayed on recovery. (A worker restart/deploy does **not** drop runs — the server still
creates the action on time and it queues.) Two tiers, set in `buildSchedulePolicies`:

- `CATCHUP_TIGHT` (5 min) on time-of-day home automation (vacuum, good-morning): skip rather
  than fire a wake-up/vacuum hours late.
- `CATCHUP_RELAXED` (1 hour, the default for everything else): reports/maintenance still run
  late after an outage. Override per-schedule via the optional `catchupWindow` field.

Caveat: a long _worker_ outage can still execute a home run late (the server already created
it on time); fully preventing that needs a staleness guard inside the workflow.

### Orphan detection

The reconciler is upsert-only and trusts the hand-maintained `DELETED_SCHEDULE_IDS`, so a
renamed/removed schedule that isn't added there keeps firing silently (has happened 4×).
`detectOrphanSchedules` (`src/schedules/orphan-detection.ts`) lists live schedules on startup
and sets the `temporal_schedule_orphans` gauge + logs any that are neither declared, nor on
the delete list, nor a dynamic agent-task schedule. A schedule counts as dynamic only via the
`agent-task-` id prefix (auto-generated ids) or the `dynamicAgentTask` memo marker stamped at
creation by the `/agent-tasks` API — **not** by `workflowType === "agentTaskWorkflow"`, which
would also exempt declared schedules running that workflow (e.g. `homelab-audit-daily`) and
silently hide them if they were ever removed from `SCHEDULES`. **Alert on
`temporal_schedule_orphans > 0`**, then add the id to `DELETED_SCHEDULE_IDS` (if removed) or
back to `SCHEDULES` (if still wanted). The gauge is set to `-1` if the live-schedule listing
itself fails (count unknown) — **alert on `< 0` separately**, since a failed scan otherwise
stays at 0 and is indistinguishable from a clean "no orphans" result.

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
- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` — GitHub App credentials used to mint short-lived installation tokens for GitHub automation so GitHub attributes those actions to the app bot.
- `OPENAI_API_KEY` — OpenAI API key
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code subscription token. Auth for every `claude -p` activity (currently pr-agent + homelab-audit).
- `ANTHROPIC_API_KEY` — direct Anthropic API key. Used by the SDK-native `runPrSummaryPipeline` activity (Phase 7 of the SOTA PR review bot plan). The Anthropic TypeScript SDK only accepts the direct API key, so this is required for the SDK summary path. Shadow-mode caveat: with both `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` set, the legacy `claude -p` CLI prefers the API key and bills direct credits instead of the subscription — accepted for the ~2-week shadow window; Phase 13 retires the CLI path and the conflict goes away.
- `POSTAL_HOST`, `POSTAL_API_KEY` — Postal email service
- `RECIPIENT_EMAIL`, `SENDER_EMAIL` — Email addresses for dependency summary and homelab audit
- `AGENT_TASK_API_TOKEN` — required bearer token for the authenticated `/agent-tasks` scheduling API on port 9467
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
- `GITHUB_WEBHOOK_PORT` — port for the GitHub webhook receiver (default `9466`).

## Homelab audit (daily)

`homelab-audit-daily` (cron `30 6 * * *` PT) now runs through the generic `agentTaskWorkflow` on the `agent-task` queue. It checks out `shepherdjerred/monorepo`, asks Claude to follow `packages/docs/guides/2026-04-04_homelab-audit-runbook.md`, renders markdown to HTML, and sends a Postal email with tag `agent-task`. The previous bespoke `runHomelabAuditWorkflow` remains in-tree as a rollback path until the generic workflow is proven in production.

The activity (`src/activities/homelab-audit.ts`) mirrors the `pr-agent` lifecycle (Bun.spawn `claude -p`, 10 s heartbeats, stderr line pump with token redaction, parsed `--output-format json` result, Sentry capture on failure, Prom metrics).

## Generic agent tasks

`agentTaskWorkflow` supports explicit one-off and cron-based report-only Claude/Codex tasks. It runs on `TASK_QUEUES.AGENT_TASK` so long LLM subprocesses do not block HA, PR review, or PR summary work.

Create/update a task from a doc block locally as an operator:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc ../../packages/docs/guides/example.md
```

Authenticated HTTP creation is the public ingress path:

```bash
curl -fsS https://temporal-agent-tasks.sjer.red/agent-tasks \
  -H "Authorization: Bearer $AGENT_TASK_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @agent-task.json
```

Do not expose direct Temporal scheduling as a public ingress path. Public creation must go through the authenticated `/agent-tasks` HTTP API with `Authorization: Bearer $AGENT_TASK_API_TOKEN`.

Inputs use `runAt` for one-off tasks or `cron` + stable `scheduleId` for recurring tasks. Recurring schedules use `America/Los_Angeles`. Agents may return `followUp` to schedule one more report-only task. Agents may return `cancelCron: true` only when the original input has `allowSelfCancel: true`; cancellation pauses the Temporal Schedule rather than deleting it.

**`claude -p --json-schema` gotcha (claude-code).** Pass the schema **inline** (`--json-schema "$(cat schema.json)"`), never a file path — a path wedges the CLI (zero bytes on stdout+stderr until killed) and was the 100% root cause of the agent-task / alert-remediation 30-min SIGTERM(143) hangs (PR #1264). The validated object is in the result message's **`structured_output`** field, NOT `result` (which is the model's prose) — read `parseClaudeResultMessage(stdout).structured_output` and Zod-validate it. Keep `--output-format stream-json --verbose` and pump **stdout** line-by-line for liveness: `claude -p` is silent on stderr, so a stderr-only idle detector is structurally blind.

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

## Scheduled PR-creating workflows

There are **two** Temporal scheduling patterns — don't conflate them:

- **Report-only agent-tasks** (`agentTaskWorkflow`, above) email reports and **cannot** open PRs/issues or edit files — `mode` is only `"report-only"` and the prompt forbids mutation.
- **Deterministic PR-creating workflows** (e.g. `src/activities/data-dragon.ts`, `pokeemerald-wasm.ts`, `readme-refresh.ts`) regenerate artifacts then `git push --force-with-lease` + `gh pr create`, authed by a GitHub App installation token (`src/lib/github-app-token.ts` `createGitHubAppInstallationToken()`, env `GITHUB_APP_ID`/`GITHUB_APP_INSTALLATION_ID`/`GITHUB_APP_PRIVATE_KEY`). scout-for-lol's data-dragon refresh is the canonical example.

To add a "weekly: regenerate X, open a PR if it changed" job, mirror `data-dragon.ts`: a deterministic activity (no Claude), GitHub App token, path-scoped `git add`, plus a thin workflow, an export in `src/workflows/index.ts`, and a `SCHEDULES` entry (cron, `America/Los_Angeles`, `TASK_QUEUES.DEFAULT`). The worker pod has bun/git/gh but **not** helm — add tools via `.dagger/src/image.ts` if the job needs them.

## Greptile review gate (Buildkite)

The `greptile-review` Buildkite step (`scripts/ci/src/wait-for-greptile.ts`) gates `ci-complete` for PRs — separate from the in-package PR review bot below.

- **Greptile's own check-run goes green as soon as the review completes**, even with its posted comments still unresolved (verified on PR #1026), so it's useless as a "comments addressed" gate. Gate instead on **review threads** via GraphQL (`pullRequest.reviewThreads { nodes { isResolved isOutdated path comments(first:1){ nodes { author{login} } } } }`): a thread blocks iff authored by `greptile-apps` (GraphQL drops the `[bot]` suffix REST shows) AND `!isResolved` AND `!isOutdated`. Use the check-run only as the "Greptile finished reviewing this commit" marker (it's present even on a clean no-comment review). Greptile auto-resolves its own threads and marks them outdated when the referenced lines change.
- An **empty-diff PR** (e.g. a superseded branch brought fully up to main, byte-identical tree) can **never** pass the gate: Greptile posts `No reviewable files after applying ignore patterns.` and never creates a review check-run, so `evaluateGate` stays `reviewing` and the step times out after 1200s. Such a PR needs a genuine reviewable diff, to be closed, or to be admin-merged once the conflict is cleared (what happened to PR #1076).

## Weekly README refresh

`readme-refresh-weekly` (cron `0 8 * * 1` PT) runs `runReadmeRefresh` on the `default` queue. The activity (`src/activities/readme-refresh.ts`) mirrors `helm-types-refresh`: clone the monorepo (full blobless history — the cog blocks sort packages by first-commit date), run `cog -r README.md practice/README.md archive/README.md` to regenerate the embedded project-listing tables, format the output with the repo's pinned prettier (see below), stage only the three READMEs + any new per-package `_summary.md`, and open a PR via `openSeasonRefreshPr` if anything drifted (no diff → no PR). This replaced the old `.buildkite/scripts/update-readmes.sh` Buildkite scheduled build.

`cog` is a Python tool, so the worker image installs cogapp via `withCogapp` in `.dagger/src/image.ts` (pinned by `COGAPP_VERSION` in `.dagger/src/constants.ts`). Per-package summaries are cached as committed `_summary.md` files, so a steady-state run makes no Codex calls; only a brand-new package without a committed summary triggers `bunx @openai/codex` (authed via the pod's `OPENAI_API_KEY`).

Two non-obvious bits the cog blocks + activity handle, learned the hard way (PR #1164):

- **codex must ignore `AGENTS.md`.** `codex exec` runs in the repo root and, left alone, obeys the repo agent docs ("every session must produce a session log") and dumps `**Done**/**Remaining**/**Caveats**` meta into the summary. The cog blocks pass `-c project_doc_max_bytes=0` so codex returns a plain project summary. Without it, ~8/21 generated summaries came out contaminated.
- **cog output isn't prettier-clean.** Its raw markdown (e.g. a missing blank line after `]]]-->`) fails the repo's prettier gate, so an unformatted auto-PR would never pass CI. The activity runs `bun install --frozen-lockfile` + `bunx prettier --write` on the regenerated files before opening the PR. In steady state cog un-formats and prettier re-formats back to the committed bytes, netting no diff. (markdownlint only checks the root `README.md`; `archive/**`, `practice/**`, and `**/_summary.md` are ignored — and clean single-paragraph summaries don't trip MD032.)

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

The `runPrSummaryPipeline` activity (`src/activities/pr-review/summary.ts`) talks to the Anthropic SDK directly. Streams Haiku 4.5 via `messages.stream(...).finalMessage()`. Prompt caching pinned to the last system block (agent instructions hierarchy). Cost target ≤$0.10/summary. See `scripts/replay-pr-summary.ts --pr <#>` for the verification harness.

**Component log values** (use these in `component:` and LogQL filters):

- `pr-webhook` — webhook server
- `pr-agent` — `claude -p` subprocess wrapper (legacy)
- `pr-summary` — SDK-native Haiku summary activity

**Shadow-mode auth caveat** — the worker pod has both `CLAUDE_CODE_OAUTH_TOKEN` (subscription, used by `claude -p`) and `ANTHROPIC_API_KEY` (used by the SDK summary). When both are set, the legacy CLI prefers the API key and bills direct-API credits instead of the subscription. We accept this for the ~2-week shadow window (Phase 12 of the SOTA plan); Phase 13 retires the CLI path and the conflict goes away.

**Models** — legacy review uses `claude-opus-4-8` (max-turns 30), legacy summary uses `claude-haiku-4-5-20251001` (max-turns 10), SDK summary uses `claude-haiku-4-5` via the official SDK with streaming.

## HA presence (welcomeHome / leavingHome / reconcileLock) — debounce model

HA `state_changed` events for `person.jerred` / `person.shuxin` flap at the home/not_home boundary (GPS / wifi / cell-tower jitter). `PRESENCE_COOLDOWN_SECONDS = 90` (`src/shared/presence.ts`) is the settle window everywhere.

**Front-door lock — owned by `reconcileLock`, not by the edge workflows.** The lock is the one side-effect that flaps audibly, so it is no longer actuated from `welcomeHome` / `leavingHome`. Instead `src/workflows/ha/reconcile-lock.ts` is a **singleton, debounced reconciler**:

- Every presence transition (both directions) calls `signalWithStart("reconcileLock", { workflowId: "reconcile-lock", signal: "presenceChanged" })` in `src/event-bridge/triggers.ts` — one workflow, started if absent, signalled if running. Attribute-only updates (`oldState === newState`, e.g. GPS coordinate churn) are ignored.
- The workflow blocks on `condition(() => edges !== seen, PRESENCE_COOLDOWN_SECONDS * 1000)` (the Temporal SDK timeout is in milliseconds); each signal bumps `edges` and restarts the wait. Reaching the timeout means a full window with no edge → the household has settled.
- Desired state is a pure function of who is home (`shouldLock(states)` — lock iff **nobody** is in the `home` zone; named zones / `unknown` count as away). It reads **live** lock + person state and **actuates only when current ≠ desired** (idempotent — a redundant trigger never clunks the bolt). A late edge during the read re-arms the loop.
- This makes lock/unlock races impossible: a single in-flight workflow, so an unlock and a lock can never both fire from one flap cycle.

**Lights / vacuums / notifications — still edge-triggered** via `welcomeHome` (arrival) and `leavingHome` (last departure). Each sleeps `PRESENCE_COOLDOWN_SECONDS` then rechecks presence (`anyoneHome()` / `everyoneAway()` from `./util.ts`); a single false transition exits as `phase=debounced`. Their workflow ids still use the `cooldownBucket()` tumbling window for dedupe — adequate for these lower-stakes effects, but note a tumbling window leaks across its boundary (it does **not** guarantee 90 s of separation); the lock no longer depends on it.

**Component log values / LogQL:** `{namespace="temporal"} | json | component="ha-presence"`. reconcileLock logs `phase=actuated` (with `desiredLocked`) or `phase=noop`.
