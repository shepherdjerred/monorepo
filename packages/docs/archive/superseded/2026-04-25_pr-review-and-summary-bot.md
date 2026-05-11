# PR Review and Summary Bot

## Status

Not Started

## Context

Two PR-time AI features:

1. **Auto code-review agent** — posts AI review on PRs.
2. **Auto-generated PR summary** — posts AI-generated summary comment on PRs.

**GitHub webhook drives Temporal directly** (Buildkite is not the trigger). LLM uses **`claude -p`** with a **GitHub MCP server** for all GitHub I/O.

### What exists today (verified)

| Feature                           | Status                     | Where                                                                                                                                                            |
| --------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code review (basic, shell prompt) | **Live** but to be retired | `.dagger/src/index.ts:1080` `codeReview` → `release.ts:853` `codeReviewHelper`. Step: `scripts/ci/src/steps/code-review.ts`, wired in `pipeline-builder.ts:131`. |
| PR summary                        | **Doesn't exist**          | `build-summary.ts` is unrelated (release annotation on `main`).                                                                                                  |
| Stale shell fallbacks             | **Dead code**              | `.buildkite/scripts/code-review.sh`, `code-review-interactive.sh` — not wired.                                                                                   |

### Foundations

- `packages/temporal/src/event-bridge/` — already turns external events (HA SSE) into Temporal workflows. GH webhook ingest goes here.
- `packages/temporal/src/workflows/deps-summary.ts` — canonical workflow→activities template.

## Architecture

```
GitHub webhook (pull_request: opened, synchronize, reopened, ready_for_review)
  └── Hono HTTP server (inside temporal worker pod)
       ├── Verify X-Hub-Signature-256
       ├── Skip: draft PRs, bot authors
       └── client.workflow.start(prReview + prSummary in parallel)
            └── Activity: Bun.spawn("claude -p --mcp-config ... --model ... prompt")
                 └── Agent uses GitHub MCP tools to fetch diff + post review/comment
```

## Webhook ingress

**Cloudflare Tunnel** — follow existing cloudflared deployment model in homelab (check `packages/homelab/src/cdk8s/` to match existing pattern, don't introduce a new one).

## File-level plan

### New — Temporal package

| File                                      | Purpose                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/event-bridge/github-webhook.ts`      | Hono server, `@octokit/webhooks-methods` sig verify, workflow start                                                     |
| `src/event-bridge/github-webhook.test.ts` | Sig rejection, draft/bot skip, workflow start args                                                                      |
| `src/activities/pr-agent.ts`              | `runClaudeAgent({kind, prContext})` — `Bun.spawn(["claude", "-p", ...])`, Temporal heartbeat, structured stderr logging |
| `src/activities/pr-agent.test.ts`         | Mock subprocess, assert MCP config, env redaction, heartbeat                                                            |
| `src/activities/pr-prompts.ts`            | Pure prompt functions for review + summary (summary includes `<!-- pr-summary -->` idempotency marker instruction)      |
| `src/workflows/pr-review.ts`              | `startToCloseTimeout: "15 minutes"`, `retry: { maximumAttempts: 2 }`                                                    |
| `src/workflows/pr-summary.ts`             | `startToCloseTimeout: "5 minutes"`                                                                                      |
| `src/observability/metrics.ts`            | `prom-client` registry on `:9465` (separate from SDK's `:9464`)                                                         |
| `src/observability/tracing.ts`            | OTel SDK + OTLP exporter + `@temporalio/interceptors-opentelemetry`                                                     |

### Modified — Temporal package

| File                        | Change                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `src/event-bridge/index.ts` | Start Hono server alongside HA listener; close both in `EventBridgeHandle.close()` |
| `src/activities/index.ts`   | Export `prAgentActivities`                                                         |
| `src/workflows/index.ts`    | Export `prReview`, `prSummary`                                                     |
| `src/worker.ts`             | Register activities; add OTel interceptors to `Worker.create`                      |
| `src/shared/schemas.ts`     | Add `PrAgentInput` Zod schema                                                      |
| `package.json`              | Add `hono`, `@octokit/webhooks-methods`, `prom-client`, OTel deps                  |
| `CLAUDE.md`                 | Document webhook port, env vars, new `component:` log values                       |

### Container changes

| File                                   | Change                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `.dagger/src/` (temporal worker image) | Install `claude` CLI + `github-mcp-server` binary, pinned via renovate constants |

### New — homelab/k8s

| File                                                   | Change                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Temporal worker chart in `packages/homelab/src/cdk8s/` | Add `Service` for Hono port; Cloudflare Tunnel ingress; secrets for `GITHUB_WEBHOOK_SECRET`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` |

### New — Grafana / alerting

| File                                                                             | Purpose                                                                                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/homelab/src/cdk8s/grafana/pr-bot-dashboard.ts`                         | Follow `temporal-dashboard.ts` pattern; rows: webhook health, workflow execution, agent subprocess, cost (token counters), recent failures (Loki) |
| `packages/homelab/src/cdk8s/grafana/pr-bot-dashboard.test.ts`                    | Snapshot test (follow `dashboard-export.test.ts`)                                                                                                 |
| `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/pr-bot.ts` | `PrWebhookSignatureFailures`, `PrAgentFailureRate`, `PrWorkflowStuck` alert rules                                                                 |

### Cleanup (after verified on ≥1 real PR)

| File                                                              | Action                                       |
| ----------------------------------------------------------------- | -------------------------------------------- |
| `scripts/ci/src/steps/code-review.ts`                             | Delete                                       |
| `scripts/ci/src/pipeline-builder.ts:131`                          | Remove `codeReviewStep()` push + import      |
| `.dagger/src/release.ts:848–915`                                  | Remove `codeReviewHelper`                    |
| `.dagger/src/index.ts`                                            | Remove `codeReview` `@func` + import line 39 |
| `.buildkite/scripts/code-review.sh`, `code-review-interactive.sh` | Delete                                       |

## Event handling rules

- Subscribe: `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`)
- Skip: `draft == true` unless action is `ready_for_review`
- Skip: `pull_request.user.type == "Bot"`
- Start both `prReview` + `prSummary` in parallel per qualifying event
- Workflow ID: `pr-{kind}-{owner}-{repo}-{prNumber}-{commitSha}` — dedup per commit, `WorkflowIdReusePolicy.ALLOW_DUPLICATE`

## Models

- **Review**: `claude-opus-4-7`, `--max-turns 30`, `--dangerously-skip-permissions`
- **Summary**: `claude-haiku-4-5-20251001`, `--max-turns 10`, `--dangerously-skip-permissions`

## Secrets / env vars

| Var                            | Used by           | Source                                    |
| ------------------------------ | ----------------- | ----------------------------------------- |
| `GITHUB_WEBHOOK_SECRET`        | Sig verification  | New 1Password item                        |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub MCP server | Reuse `GH_TOKEN` if scopes allow PR write |
| `CLAUDE_CODE_OAUTH_TOKEN`      | `claude -p`       | Already in CI                             |
| `TEMPORAL_ADDRESS`             | Worker            | Already configured                        |

## Observability

Worker already has: `jsonLog`, Sentry (`@sentry/bun`), Temporal SDK Prometheus on `:9464`.

**Logging** — use `jsonLog` with `component:` values: `pr-webhook`, `pr-agent`, `pr-review-workflow`, `pr-summary-workflow`. Stream subprocess stderr line-by-line through `jsonLog`; redact token values.

**Sentry** — `Sentry.captureException` in webhook catch-all and activity catch-all (before re-throw).

**Tracing** — OTel spans: `pr.webhook.received → pr.workflow.{review|summary} → pr.activity.run_claude_agent → pr.subprocess.claude`. Temporal SDK interceptor auto-links workflow/activity spans.

**Metrics** (`:9465`, `prom-client`):

- `pr_webhook_received_total{event,action}`
- `pr_webhook_skipped_total{reason}`
- `pr_webhook_signature_failures_total`
- `pr_agent_subprocess_duration_seconds{kind,model,exit_code}` histogram
- `pr_agent_subprocess_exit_total{kind,exit_code}`
- `pr_agent_tokens_total{kind,model,direction}` (best-effort parse)

## Verification

1. `cd packages/temporal && bun test pr-agent github-webhook` — unit tests
2. `bun run typecheck` + `bun run lint`
3. Local: `smee.io` forward → local Hono server; confirm sig verify + workflow start
4. Manual: `temporal workflow start --type prSummary ...` against a draft PR; confirm comment with marker
5. Idempotency: push no-op commit; confirm summary is edited in place, not duplicated
6. Production smoke: register webhook against CF Tunnel URL; open PR; confirm both comments land + Temporal UI green
7. Failure: kill `CLAUDE_CODE_OAUTH_TOKEN`; confirm Temporal shows red + stderr captured
8. Grafana: confirm `pr_webhook_received_total` visible, trace hierarchy in Tempo, `PrWebhookSignatureFailures` alert fires on 5 bad-sig requests

## Open items

- **MCP server**: prefer Go `github/github-mcp-server`; fall back to npm `@modelcontextprotocol/server-github` if Go binary is awkward in the image
- **Bot list**: starts with `user.type == "Bot"`; may need per-bot allowlist for opt-in summaries
- **Cost guardrail**: if Renovate sync summaries get expensive, restrict to `opened` + `ready_for_review` only
