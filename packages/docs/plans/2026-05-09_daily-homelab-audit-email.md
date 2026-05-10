# Daily Homelab Audit Email

## Status

Complete (code + RBAC + Dagger image) — 2026-05-10. Layer 6 (cluster smoke) requires the operator to populate the new 1Password fields and merge/build the worker image; the schedule is registered and will fire automatically on next 06:30 PT after that.

## Context

The homelab health audit is run by hand (~weekly) by spinning up 8 parallel Claude agents that follow `packages/docs/guides/2026-04-04_homelab-audit-runbook.md`, producing dated guides like `packages/docs/guides/2026-05-08_homelab-health-audit.md`. The output is comprehensive (TL;DR, per-section tables, ArgoCD app health matrix, PD triage, deep dives), but it only runs when a human kicks it off.

This plan automates that audit on a daily cadence, delivering it via email at 06:30 PT, covering: open PD alerts, open Bugsink issues, Home Assistant entity status, OpenTofu drift, hardware (SMART/temps/utilization/disk), Kubernetes + Talos, ArgoCD app health matrix, Scout for LoL status, Grafana dashboard/alert review, and Loki log analysis.

The existing `deps-summary` Temporal workflow → Postal email pipeline (`packages/temporal/src/workflows/deps-summary.ts` + `packages/temporal/src/activities/deps-summary.ts`) is the delivery template. The existing `pr-agent` activity (`packages/temporal/src/activities/pr-agent.ts`) is the `claude -p` invocation template.

## Approach

- **Agentic, single activity.** A new `runHomelabAuditAgent` activity invokes `claude -p` with `--model claude-opus-4-7`, hands it the audit runbook as the prompt, and lets it run `kubectl`, `talosctl`, `tofu`, `toolkit pd/bugsink/gf`, plus the GitHub MCP server. Mirrors how `2026-05-08_homelab-health-audit.md` was actually produced.
- **Markdown → HTML for email.** The agent returns a markdown audit (same shape as the hand-run audits). A renderer (`packages/temporal/src/shared/markdown-to-html.ts`) converts it to inlined HTML for Postal.
- **Daily 06:30 PT.** Cron `30 6 * * *` (06:00 is taken by `dns-audit-daily`).
- **OpenTofu and Talos covered in v1.** The `tofu`, `talosctl`, `argocd`, `velero`, and `toolkit` binaries are added to the worker image. Read-only credentials (PD, Bugsink, Grafana, ArgoCD, Talos, OpenTofu provider creds) injected via a new `homelab-audit` 1Password item.

## Files

| Path                                                              | Change                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/temporal/src/activities/homelab-audit.ts` (new)         | `runHomelabAuditAgent` activity. `Bun.spawn` `claude -p`, heartbeat every 10 s, stderr line pump with token redaction, `parseClaudeResultMessage`, return markdown.                                                                           |
| `packages/temporal/src/activities/homelab-audit-prompts.ts` (new) | `buildAuditPrompt({sectionsFilter})` — embeds the runbook + output-format requirements.                                                                                                                                                       |
| `packages/temporal/src/workflows/homelab-audit.ts` (new)          | `runHomelabAuditWorkflow`: agent → render → send. 45 min start-to-close, 30 s heartbeat, 3 attempts.                                                                                                                                          |
| `packages/temporal/src/shared/postal.ts` (new)                    | Extract `sendPostalEmail({to, from, subject, htmlBody, tag})` from `deps-summary.ts:384-479`. Update `deps-summary.ts` to import.                                                                                                             |
| `packages/temporal/src/shared/markdown-to-html.ts` (new)          | `marked` + inlined `<style>`. Email-safe HTML. Pure function.                                                                                                                                                                                 |
| `packages/temporal/src/activities/index.ts`                       | Export `homelabAuditActivities`.                                                                                                                                                                                                              |
| `packages/temporal/src/workflows/index.ts`                        | Export `runHomelabAuditWorkflow`.                                                                                                                                                                                                             |
| `packages/temporal/src/schedules/register-schedules.ts`           | Add `homelab-audit-daily` cron `30 6 * * *`, 60 min timeout, SKIP overlap.                                                                                                                                                                    |
| `packages/temporal/src/observability/metrics.ts`                  | Add `homelab_audit_subprocess_duration_seconds`, `homelab_audit_tokens_total{direction}`, `homelab_audit_email_sent_total`.                                                                                                                   |
| `packages/temporal/src/scripts/run-homelab-audit-local.ts` (new)  | Layer-2 test harness (no Temporal). `DRY_RUN=1` writes to `/tmp` instead of POSTing. `--sections=N,M` for cheap iteration.                                                                                                                    |
| `packages/temporal/CLAUDE.md`                                     | Document new env vars + the local-test recipe.                                                                                                                                                                                                |
| `packages/temporal/package.json`                                  | Add `marked`. Extend test path to include `src/shared` and `src/scripts`.                                                                                                                                                                     |
| `.dagger/src/image.ts`                                            | New helpers `withTalosctl`, `withTofu`, `withArgoCdCli`, `withVeleroCli`, `withToolkit`. Each SHA-pinned with `--version` smoke check.                                                                                                        |
| `.dagger/src/deps.ts`                                             | Pin `TALOSCTL_VERSION`, `TOFU_VERSION`, `ARGOCD_VERSION`, `VELERO_VERSION` (Renovate-tracked).                                                                                                                                                |
| `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`     | Cluster-wide read-only `ClusterRole temporal-worker-audit-reader`; new `homelab-audit` 1Password item; injected env vars (`TALOSCONFIG`, `KUBECONFIG`, `ARGOCD_*`, `PAGERDUTY_TOKEN`, `BUGSINK_*`, `GRAFANA_*`); CPU/mem bumped to 1500m/4Gi. |
| `packages/docs/index.md`                                          | Add link to this plan.                                                                                                                                                                                                                        |

## Reused code

- `packages/temporal/src/activities/pr-agent.ts:78-344` — full `claude -p` lifecycle (spawn, heartbeat, stderr pump, redaction, JSON parse, Sentry, metrics).
- `packages/temporal/src/shared/claude-result.ts:parseClaudeResultMessage` — parse `--output-format json` envelope.
- `packages/temporal/src/activities/deps-summary.ts:384-479` (`formatAndSendEmail`) — extract into `shared/postal.ts`.
- `packages/docs/guides/2026-04-04_homelab-audit-runbook.md` — embedded as the prompt at activity startup via `Bun.file().text()` (baked into the worker image).
- `packages/temporal/src/schedules/register-schedules.ts:34-43` (`deps-summary-weekly`) — schedule entry template.

## RBAC (cluster-wide read for the worker SA)

New `ClusterRole temporal-worker-audit-reader`:

| API group               | Resources                                                                                                   | Verbs            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------- |
| `""` (core)             | pods, services, events, persistentvolumeclaims, persistentvolumes, nodes, namespaces, configmaps, endpoints | get, list, watch |
| `apps`                  | deployments, statefulsets, daemonsets, replicasets                                                          | get, list, watch |
| `batch`                 | jobs, cronjobs                                                                                              | get, list, watch |
| `networking.k8s.io`     | ingresses, networkpolicies                                                                                  | get, list, watch |
| `argoproj.io`           | applications, applicationsets, appprojects                                                                  | get, list, watch |
| `velero.io`             | backups, schedules, backupstoragelocations, restores                                                        | get, list, watch |
| `cert-manager.io`       | certificates                                                                                                | get, list, watch |
| `monitoring.coreos.com` | servicemonitors, prometheusrules                                                                            | get, list, watch |

No `pods/exec`. No write verbs.

## Email output

Subject: `Homelab Audit YYYY-MM-DD — N Red, M Yellow, K Green | P open PD`. Status counts parsed from the agent's TL;DR.
Body: HTML rendered from the agent's markdown. Inline `<style>` block — table borders, monospaced for tables, max-width 900 px. Tag: `homelab-audit`.

If the agent returns nothing usable (parse failure, refusal, timeout), the activity throws, and Temporal retries up to 3 times with backoff. After exhaustion, the workflow surfaces the failure via the existing Temporal alert path (no special handling).

## Verification — iterate locally before touching the cluster

The agent body is just `Bun.spawn(["claude", "-p", ...])`. Every dependency (`kubectl @ admin@torvalds`, `talosctl`, `tofu` with `op run`, `toolkit pd/bugsink/gf`, `claude` CLI, the audit runbook on disk) is already authenticated on the user's Mac. Nothing about the iteration loop requires a worker-image rebuild or a Temporal deploy until layer 6.

### Layer 1 — pure functions (< 1 s feedback)

- `markdown-to-html.ts`: golden-file test against `2026-05-08_homelab-health-audit.md` → tables, headings, status emojis survive round-trip.
- `homelab-audit-prompts.ts`: snapshot test on the assembled prompt.
- `shared/postal.ts`: extracted `sendPostalEmail` keeps the zod-validated envelope check; new test stubs `fetch`.

### Layer 2 — local end-to-end without Temporal

```bash
cd packages/temporal
op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts
```

Imports `runHomelabAuditAgent` directly with a stubbed `Context.current()` (no Temporal client, no heartbeats — `safeHeartbeat` is a no-op outside an activity). Streams stderr in real time. On success: writes `/tmp/homelab-audit-<ts>.md` and `.html`, prints the would-be subject. With `DRY_RUN=0` and `RECIPIENT_EMAIL=…+audit-test@…`, sends through real Postal.

### Layer 3 — cheap prompt iteration

`--sections=1,9,13` filters the runbook to listed sections only (validates §13 health-matrix table rendering in 2–3 minutes vs. a full ~30-minute audit). `--haiku` swaps the model for prompt-shape iteration.

### Layer 4 — workflow correctness (no cluster needed)

`workflows/homelab-audit.test.ts` drives `runHomelabAuditWorkflow` against `TestWorkflowEnvironment` with `runHomelabAuditAgent` mocked to return canned markdown. Existing `bundle.test.ts` keeps verifying the workflow bundle webpacks.

### Layer 5 — local Temporal worker, real schedule path

```bash
temporal server start-dev --ui-port 8233 &
op run --env-file=.env.audit -- TEMPORAL_ADDRESS=localhost:7233 bun run start
op run --env-file=.env.audit -- bun run src/scripts/trigger-homelab-audit.ts
```

### Layer 6 — cluster smoke

1. Build & push worker image via Dagger; verify `--version` smoke checks pass.
2. Manually trigger via Temporal UI ("Run Now").
3. Confirm email arrives. Compare against most recent hand-run audit.
4. Record `homelab_audit_tokens_total` + `homelab_audit_subprocess_duration_seconds`. If > 200 k input, > 50 k output, or > 35 min wall, tune the prompt **before** the schedule fires.
5. Watch one cron-driven fire (06:30 PT next morning). Then leave it running.

## Followups (out of v1)

- Day-over-day delta comparison (the hand-run audits compare to a baseline; daily cadence makes a same-day delta possible — but adds state).
- Auto-archive each day's markdown to `packages/docs/guides/audits/YYYY-MM-DD.md` via a follow-on activity.
- Slack/Discord short-form digest in addition to email.
- Auto-fixers for the common items the audit surfaces every run (Released PVs, OOMKill memory bumps).

## Session Log — 2026-05-09

### Done

- Approved harness plan mirrored to this file; `packages/docs/index.md` updated.
- Postal email helper extracted to `packages/temporal/src/shared/postal.ts` (with `readPostalConfigFromEnv` + `sendPostalEmail(input, config)` injection so tests don't mutate process env). `deps-summary.ts` updated to consume it. 8-test suite at `src/shared/postal.test.ts`.
- `packages/temporal/src/shared/markdown-to-html.ts` — `marked`-based renderer with inlined `<style>`, plus `extractAuditSubjectCounts` + `buildAuditEmailSubject`. 9 tests at `src/shared/markdown-to-html.test.ts`.
- `packages/temporal/src/activities/homelab-audit-prompts.ts` — fetches the runbook (HTTPS by default; `RUNBOOK_PATH` env override for local dev), builds the prompt, supports section filtering for cheap iteration. 6 tests at `src/activities/homelab-audit-prompts.test.ts`.
- `packages/temporal/src/activities/homelab-audit.ts` — `runHomelabAuditAgent` and `sendHomelabAuditEmail` activities; mirrors `pr-agent.ts` lifecycle (Bun.spawn, 10 s heartbeat, stderr line pump with token redaction, JSON result parse, Sentry capture, Prom metrics). `Context.current()` access wrapped so the activity can also run outside Temporal in the local dev script.
- `packages/temporal/src/workflows/homelab-audit.ts` — `runHomelabAuditWorkflow`: agent (45 min start-to-close, 60 s heartbeat) → email (1 min). Wired through `workflows/index.ts`.
- `packages/temporal/src/observability/metrics.ts` — added `homelab_audit_subprocess_duration_seconds`, `homelab_audit_subprocess_exit_total`, `homelab_audit_tokens_total{model,direction}`, `homelab_audit_email_sent_total{outcome}`.
- `packages/temporal/src/schedules/register-schedules.ts` — `homelab-audit-daily` cron `30 6 * * *`, 60 min timeout, SKIP overlap.
- `packages/temporal/scripts/run-homelab-audit-local.ts` — Layer-2 test harness with `DRY_RUN=1`, `--sections=`, `--haiku`, `--model=`, `--date=` flags. Writes `/tmp/homelab-audit-<ts>.md` + `.html` for inspection.
- `packages/temporal/package.json` — added `marked@^18.0.3`. Test path extended to include `src/shared`.
- `.dagger/src/constants.ts` — Renovate-tracked `TALOSCTL_VERSION`, `TOFU_VERSION`, `ARGOCD_CLI_VERSION`, `VELERO_CLI_VERSION`.
- `.dagger/src/image.ts` — new helpers `withTalosctl`, `withTofu` (sha256 verified), `withArgoCdCli`, `withVeleroCli`, plus `withHomelabAuditClis` bundler. Wired into the `buildTemporalWorkerImage` chain.
- `packages/homelab/src/cdk8s/src/resources/temporal/audit-rbac.ts` (new) — `temporal-worker-audit-reader` ClusterRole + binding (cluster-wide read on core/apps/batch/networking/argoproj/velero/cert-manager/monitoring; no exec, no writes).
- `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts` — wires audit RBAC; bumps CPU/mem to 1500m / 4 GiB; adds optional env vars `PAGERDUTY_TOKEN`, `BUGSINK_URL`, `BUGSINK_TOKEN`, `GRAFANA_URL`, `GRAFANA_API_KEY`, `ARGOCD_SERVER`, `ARGOCD_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`.
- `packages/temporal/CLAUDE.md` — documents the new env vars + the homelab-audit local-dev recipe.
- Verification: `cd packages/temporal && bun run typecheck` clean, `bun run test` 55/55 pass, `bun run lint` clean, `./src/workflows/bundle.test.ts` webpacks the new workflow imports cleanly. `cd packages/homelab && bun run typecheck` clean, eslint clean.

## Session Log — 2026-05-10

### Done — closed every deferral from the 2026-05-09 log

- **Toolkit binary now compiled into the worker image.** Added `withToolkit(container)` to `.dagger/src/image.ts` (runs `bun install --frozen-lockfile` + `bun build --compile --outfile=/usr/local/bin/toolkit` in `/workspace/packages/toolkit`, then `toolkit --version` smoke check). Wired into `buildTemporalWorkerImageHelper` conditionally on `depNames.includes("toolkit")`. Added `"toolkit"` to `WORKSPACE_DEPS["temporal"]` in `.dagger/src/deps.ts` so the CI mounts the toolkit source. Restored the runbook-style `toolkit pd|bugsink|gf` references in the audit prompt (replacing the curl recipes) — `packages/temporal/src/activities/homelab-audit-prompts.ts`.
- **TALOSCONFIG injection wired.** Added a projected `Volume.fromSecret` mount in `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts` that surfaces 1P field `TALOSCONFIG_YAML` as `/etc/talos/config` (read-only, mode 0400, `optional: true` so a missing field doesn't break pod startup). Set `TALOSCONFIG=/etc/talos/config` in env. Updated the prompt and `packages/temporal/CLAUDE.md` accordingly.
- **TestWorkflowEnvironment-driven workflow test.** New `packages/temporal/src/workflows/homelab-audit.test.ts` drives `runHomelabAuditWorkflow` against `TestWorkflowEnvironment.createTimeSkipping()` with the agent and email activities mocked. Asserts agent → email order, retry policy on transient failure, and that the workflow input flows through to the email activity. Added `@temporalio/testing@1.16.1` (exact-pinned) — also pinned the existing `@temporalio/{activity,client,common,worker,workflow}` from `^1.16.1` to exact `1.16.1` to avoid the protobuf-namespace duplicate registration that hits when the testing package's nested `@temporalio/proto` resolves to a different patch than the rest.
- **Layer 5 trigger script added.** New `packages/temporal/scripts/trigger-homelab-audit.ts` connects to whatever `$TEMPORAL_ADDRESS` resolves to, starts a `runHomelabAuditWorkflow` execution with a unique ID, and (by default) waits for the result. Used in the verification ladder Layer 5 once the prompt is dialed in.
- **Verification:** `cd packages/temporal && bun run typecheck` clean, `bun run test` 58/58 pass (including 2 new TestWorkflowEnvironment tests), `bun run lint` clean. `cd packages/homelab && bun run typecheck` clean, eslint clean. `cd packages/homelab/src/cdk8s && bunx eslint --cache src/resources/temporal/` clean.

### Remaining (operator only — no further code changes)

- **Populate 1Password item `temporal-temporal-worker-1p`** with the new fields. Per `feedback_dont_modify_1p_items`, do not rename existing fields:
  - `PAGERDUTY_TOKEN`, `BUGSINK_URL`, `BUGSINK_TOKEN`
  - `GRAFANA_URL`, `GRAFANA_API_KEY`
  - `ARGOCD_SERVER`, `ARGOCD_AUTH_TOKEN`
  - `CLOUDFLARE_API_TOKEN` (read-only token, scope: Account:Read + Zone:Read)
  - `TALOSCONFIG_YAML` (the full talosconfig file contents as a single string — `talosctl config view --raw` on a configured workstation produces the value)
- **Layer 2 dry-run locally** before merging:

  ```bash
  cd packages/temporal
  op run --env-file=.env.audit -- DRY_RUN=1 bun run scripts/run-homelab-audit-local.ts --sections=1,9,13
  ```

  Confirm the rendered HTML at `/tmp/homelab-audit-<ts>.html` is comparable in depth to `packages/docs/guides/2026-05-08_homelab-health-audit.md`. Iterate the prompt while it's cheap.

- **Layer 5 trigger against local Temporal dev server** (optional, recommended once before merge):

  ```bash
  temporal server start-dev --ui-port 8233 &
  op run --env-file=.env.audit -- TEMPORAL_ADDRESS=localhost:7233 bun run start &
  op run --env-file=.env.audit -- TEMPORAL_ADDRESS=localhost:7233 bun run scripts/trigger-homelab-audit.ts
  ```

- **Layer 6** — after merge, the worker image rebuilds via the existing Buildkite pipeline. Once deployed, manually trigger via Temporal UI ("Run Now" on `homelab-audit-daily`) once. Confirm the email arrives, then leave the schedule running.
- **Cost gate** — record `homelab_audit_tokens_total` and `homelab_audit_subprocess_duration_seconds` after the first successful run. If a single run is > 200 k input, > 50 k output, or > 35 min wall, tune the prompt before the next 06:30 PT fire.

### Caveats

- **`tofu plan -detailed-exitcode` returns 2 on drift.** The prompt notes this is "drift detected" rather than failure; if the agent treats exit 2 as failure, tighten the wording on the next iteration.
- **Postal "tag" filtering.** Mail will arrive with tag `homelab-audit` (production) and `homelab-audit-test` (local `DRY_RUN=0` send via `scripts/run-homelab-audit-local.ts`). Inbox rules can split them.
- **Runbook fetched over HTTPS from `main` at activity startup.** A bad commit to the runbook breaks the next morning's audit. Rollback: revert the runbook commit; the next run picks it up — no image rebuild needed.
- **`@temporalio/testing` pinned to exact 1.16.1.** It pulls a transitive copy of `@temporalio/worker`; with `^1.16.1` Bun resolves the transitive copy to a different patch and the `NativeConnection` types diverge. Pinning all five `@temporalio/*` packages to exact `1.16.1` keeps the test environment compatible. Renovate may still propose minor bumps — accept them as a coordinated set.
- **Toolkit binary build cost.** The toolkit binary is compiled in-place during the worker-image build (`bun build --compile` inside `withToolkit`). Adds ~30 s to image build time and ~50 MB to image size due to bundled `@lancedb/lancedb` native module. Acceptable for a daily image rebuild; revisit if it grows.
