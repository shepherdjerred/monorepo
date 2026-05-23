# Temporal Post-Deploy Quality Checklist

## Status

Partially Complete

## Purpose

Verify that the deployed Temporal changes are doing what we intended after several days of production bake time. Use this as a pass/fail checklist, not a general audit. Every checked item should have evidence: command output, dashboard link, workflow ID, email timestamp, PR number, Bugsink issue, or alert link.

## Scope

- Generic `agentTaskWorkflow` and authenticated `/agent-tasks` ingress.
- `homelab-audit-daily` running through the `agent-task` queue.
- Homelab audit worker tooling: `bk`, `temporal`, preflight checks, S3 archive, read-only RBAC.
- PR review / summary bot workflows, inline findings, lifecycle comments, metrics, and nightly eval.
- Scout Data Dragon image-only suppression.
- LLM observability archive/tracing for Temporal calls.
- Residual Temporal workflow failures and Bugsink noise.

## Run Results — 2026-05-22

Bake window used: `2026-05-19T12:00:00Z` through the current run on 2026-05-22.

Overall result: **not green**. The platform is healthy and several intended deploy artifacts are live, but the quality gate found production failures that need follow-up before the Temporal plans should be marked complete.

### Pass

- Temporal platform health: `kubectl get pods -n temporal` showed server, UI, worker, Postgres, and Redis pods `Running`; `temporal operator cluster health` returned `SERVING`.
- ArgoCD deployment health: `argocd app get temporal -o json` reported `status.sync.status=Synced`, `status.health.status=Healthy`, revision `2.0.0-2647`, with current worker image `ghcr.io/shepherdjerred/temporal-worker:2.0.0-2635@sha256:b8ae933b9e584e973f089b48089fe505ef672985bdb44231f1e2657df10e9ae9`.
- Agent-task ingress auth: unauthenticated `POST https://temporal-agent-tasks.sjer.red/agent-tasks` returned `HTTP/2 401` and body `unauthorized`.
- Schedule shape: `homelab-audit-daily` is registered as `agentTaskWorkflow` on task queue `agent-task`, timezone `America/Los_Angeles`, overlap policy `Skip`, timeout `2h`, `Paused=false`, and `allowSelfCancel=false` in the decoded input.
- PR review lifecycle comments exist: PR #864 had a successful `<!-- pr-review-bot-status -->` no-findings comment; PR #865 had a visible failed status comment pointing to workflow `pr-review-pipeline-shepherdjerred-monorepo-865-bcb13499a860b18e754234acf5629539753b8ea2`.
- PR summary path works on normal-sized PRs: PR #864 got SDK summary comment `<!-- pr-summary-sdk -->`, and worker logs show `Posted PR summary` with `durationMs=9775`, `costUsd=0.01756`, `inputTokens=14020`, `outputTokens=708`.
- Data Dragon cadence is intact: `scout-data-dragon-version-check` is Sunday-Friday at 06:00 PT, `scout-data-dragon-weekly-refresh` is Saturday at 06:00 PT, and `runScoutDataDragonVersionCheck` completed at `2026-05-22T13:00:00Z`.

### Fail

- `homelab-audit-daily` timed out on 2026-05-22. `temporal workflow describe --workflow-id homelab-audit-daily-workflow-2026-05-22T13:30:00Z` showed `Status TIMEOUT`, runtime exactly `2h0m0s`. Worker logs show `runAgentTask` attempt 1 and attempt 2 for the same workflow, but no email/send completion. The daily audit cannot be considered proven.
- `prReviewEvalWorkflow` is not running correctly. `pr-review-eval-nightly-workflow-2026-05-22T11:00:00Z` failed after 3.24s with `PR_REVIEW_FIXTURES_REPO_URL missing — required to clone the private fixtures repo`.
- PR review pipeline still fails on real PRs:
  - PR #863 failed with `RuntimeError: Aborted(). Build with -sASSERTIONS for more info.` from `web-tree-sitter`.
  - PR #865 failed with `Activity task timed out`; logs show `git clone ... failed (exit 128)` with `fatal: unable to write new index file` and earlier `fatal: fetch-pack: invalid index-pack output`.
- PR summary pipeline fails on large PRs. PR #865 failed with GitHub API `diff too_large`: `Sorry, the diff exceeded the maximum number of files (300). Consider using 'List pull requests files' API or locally cloning the repository instead.`
- Provider health is actively paging. Prometheus showed `ai_provider_issue_active{app="temporal", provider="anthropic", kind="rate_limit", source="pr_review_specialist"} = 1`, and PagerDuty incident #4840 is open for "Temporal AI provider anthropic rate_limit issue active".
- Agent-task Prometheus counters were empty for `agent_task_runs_total`, `agent_task_email_sent_total`, and `agent_task_subprocess_duration_seconds` over 72h despite the timed-out audit workflow. Either the timeout path does not emit the expected metrics, or the query/series shape is wrong. This weakens observability for the generic scheduler.
- Bugsink still has one unresolved Temporal issue: `HaWebSocketError: WebSocket failed to open`, 5 events, last seen 2026-05-19 08:54:54.

### Not Verified

- Audit email readability and S3 archive objects were not verified because the 2026-05-22 audit timed out before email/archive completion.
- Authenticated `/agent-tasks` creation was not exercised to avoid sending an extra real email/task during this failure-focused run.
- LLM archive objects were not verified in S3. Logs show trace IDs for PR summary work, but the archive bucket was not checked.
- Data Dragon image-only suppression could not be proven from this window because the observed 2026-05-22 version-check was a no-op: latest and current were both `16.10.1`.
- Active PagerDuty incidents include several non-Temporal homelab incidents during the run, including Prometheus PVC usage and NVMe temperature. These are not direct failures of the Temporal deploy but affect the daily audit's live context.

### Follow-Ups

- Fix `homelab-audit-daily` runtime behavior: inspect the audit subprocess output/heartbeat path, decide whether the audit needs prompt scoping, a longer timeout, streaming partial output, or a smaller default section set.
- Add `PR_REVIEW_FIXTURES_REPO_URL` and any required fixture credentials to the Temporal worker secret/config, or pause `pr-review-eval-nightly` until the secret path is ready.
- Harden PR review/summary for large PRs: avoid GitHub's 300-file diff endpoint for summary, avoid full checkout/index writes for oversized archive PRs, and make large PRs fail gracefully with a useful status instead of timing out.
- Investigate the `web-tree-sitter` abort in `prReviewPipeline`; this is still recurring after deploy.
- Confirm `agent_task_*` metrics are emitted on timeout/failure paths and are scraped by `temporal-worker-app-metrics`.
- Resolve or intentionally mute the lingering Temporal `HaWebSocketError` Bugsink issue after confirming the HA bridge supervisor is behaving as designed.

## Setup

- [x] Pick the exact bake window.
  - Suggested: last 72 hours, or from the deployment timestamp to now.
  - Evidence: `2026-05-19T12:00:00Z` through this run on 2026-05-22.

- [x] Confirm the deployed worker image/tag includes the intended commits.
  - Check ArgoCD, pod image digest, and `git log` for the deploy commit.
  - Evidence: ArgoCD Healthy/Synced at revision `2.0.0-2647`; worker image `ghcr.io/shepherdjerred/temporal-worker:2.0.0-2635@sha256:b8ae933b9e584e973f089b48089fe505ef672985bdb44231f1e2657df10e9ae9`.

- [x] Confirm the Temporal worker is healthy before checking behavior.
  - `kubectl get pods -n temporal`
  - `argocd app get temporal`
  - `temporal operator cluster health`
  - Pass: server, UI, worker, and Postgres are healthy; Temporal reports `SERVING`.
  - Evidence: all main pods `Running`, ArgoCD `Healthy/Synced`, Temporal cluster health `SERVING`.

## Temporal Platform Health

- [ ] No new failed, timed-out, canceled, or terminated workflows in the bake window unless expected and explained.
  - `temporal workflow list --query "ExecutionStatus='Failed' AND CloseTime > '<SINCE_RFC3339>'"`
  - `temporal workflow list --query "ExecutionStatus='TimedOut' AND CloseTime > '<SINCE_RFC3339>'"`
  - `temporal workflow list --query "ExecutionStatus IN ('Canceled','Terminated') AND CloseTime > '<SINCE_RFC3339>'"`
  - Pass: empty, or every result has an accepted reason and no repeated pattern.
  - Evidence: failed workflows found: PR #865 `prReviewPipeline` heartbeat timeout, PR #865 `prSummaryPipeline` GitHub diff too large, `pr-review-eval-nightly` missing `PR_REVIEW_FIXTURES_REPO_URL`, PR #863 `web-tree-sitter` abort. Timed-out workflow found: `homelab-audit-daily-workflow-2026-05-22T13:30:00Z`.

- [x] Scheduled workflows are registered with the intended workflow type, queue, timeout, and overlap policy.
  - `temporal schedule describe --schedule-id homelab-audit-daily`
  - `temporal schedule describe --schedule-id pr-review-eval-nightly`
  - `temporal schedule describe --schedule-id scout-data-dragon-version-check`
  - `temporal schedule describe --schedule-id scout-data-dragon-weekly-refresh`
  - Pass: `homelab-audit-daily` targets `agentTaskWorkflow` on `agent-task`, SKIP overlap, 2 hour timeout.
  - Evidence: `homelab-audit-daily` is `agentTaskWorkflow` on `agent-task`, SKIP overlap, 2h timeout; `pr-review-eval-nightly` is `prReviewEvalWorkflow` on `pr-review`, SKIP overlap, 2h timeout; Data Dragon schedules are registered on `default`, SKIP overlap, 3h timeout.

- [ ] The `agent-task` queue is not starving other queues.
  - Check running workflows older than expected by queue.
  - Check worker logs for poller or sticky-cache failures.
  - Pass: no long-running agent task blocks `DEFAULT`, `PR_REVIEW`, or `PR_SUMMARY` work.
  - Evidence:

## Homelab Audit

- [ ] `homelab-audit-daily` fired on schedule and completed successfully on each bake-window day.
  - `temporal schedule describe --schedule-id homelab-audit-daily`
  - `temporal workflow list --query "WorkflowType='agentTaskWorkflow' AND StartTime > '<SINCE_RFC3339>'"`
  - Pass: one completed run per expected 06:30 PT fire; no overlap skips caused by a stuck prior run.
  - Evidence: schedule fired, but 2026-05-22 run timed out after exactly 2h and did not complete.

- [ ] Audit emails arrived and are readable.
  - Check inbox for `Homelab Audit` messages tagged through Postal as `agent-task`.
  - Pass: subject is useful, body renders tables/sections, no obvious truncation, and "Remaining action items" are specific.
  - Evidence: not verified; 2026-05-22 audit timed out before completion.

- [ ] The audit used real live evidence and did not mutate systems.
  - Spot-check at least three claims against source systems: PagerDuty, Prometheus/Grafana, Kubernetes/ArgoCD, Bugsink, or Temporal.
  - Pass: claims match live state; no GitHub, Kubernetes, PagerDuty, Grafana, Bugsink, Cloudflare, file, or git mutations from the audit run.
  - Evidence:

- [ ] Preflight/tooling gaps are gone from the email.
  - Pass: the report no longer complains about missing `bk`, missing `temporal`, pod-exec gaps, Bugsink host mismatch, Grafana managed-alert confusion, or missing Cloudflare checkout prerequisites.
  - Evidence:

- [ ] Audit archive objects exist.
  - Check SeaweedFS/S3 for Markdown, HTML, and metadata objects for each successful audit.
  - Pass: every delivered email has matching body and metadata archive objects.
  - Evidence: not verified; 2026-05-22 audit timed out before completion.

- [ ] Runtime and cost are within the original guardrails.
  - `toolkit gf query 'histogram_quantile(0.95, sum(rate(agent_task_subprocess_duration_seconds_bucket[72h])) by (le))'`
  - `toolkit gf query 'sum(increase(agent_task_runs_total{provider="claude",outcome!="success"}[72h]))'`
  - Pass: p95 runtime is comfortably below 35 minutes for the audit path, and failures are zero.
  - Evidence: failed. `homelab-audit-daily` hit the 2h workflow timeout; `agent_task_*` Prometheus queries returned empty frames for run/email/runtime metrics.

## Agent Task API

- [x] Public unauthenticated scheduling is rejected.
  - `curl -i https://temporal-agent-tasks.sjer.red/agent-tasks -H 'Content-Type: application/json' --data '{}'`
  - Pass: `401` or equivalent unauthorized response; no workflow is started.
  - Evidence: unauthenticated `curl` returned `HTTP/2 401` with body `unauthorized`.

- [ ] Authenticated scheduling works for one low-risk report-only task.
  - Use a harmless prompt that inspects repo metadata only and emails a report.
  - Pass: request returns a workflow/schedule identifier, Temporal shows `agentTaskWorkflow`, and Postal sends one email.
  - Evidence: not exercised during this run.

- [x] Follow-up scheduling and cron self-pause behavior are not accidentally enabled for the daily audit.
  - Check the `homelab-audit-daily` input.
  - Pass: `allowSelfCancel: false`; no unexpected follow-up schedules were created by daily audits.
  - Evidence: `homelab-audit-daily` input has `allowSelfCancel:false`; schedule `Paused=false`; no unexpected follow-up schedule was observed in the schedule output.

## PR Review And Summary Bot

- [x] Fresh non-draft PRs receive visible lifecycle status comments.
  - Check at least two PRs opened after deploy.
  - Pass: running/final/failed/skipped status is visible instead of silent.
  - Evidence: PR #864 received a successful no-findings status comment; PR #865 received a failed status comment with workflow ID and failure reason.

- [ ] Inline findings post when the pipeline verifies a real issue.
  - Check recent PRs with review findings or run the read-only replay harness against a known fixture.
  - Pass: inline comments land on valid diff anchors with hidden duplicate markers; unanchored findings are skipped with an explicit reason.
  - Evidence:

- [ ] Summary comments are stable during shadow mode.
  - Pass: legacy and SDK summary comments use distinct markers, update in place, and do not churn duplicate comments.
  - Evidence:

- [x] PR review metrics are populated and plausible.
  - `toolkit gf query 'sum(increase(pr_review_count_total[72h])) by (status)'`
  - `toolkit gf query 'histogram_quantile(0.95, sum(rate(pr_review_latency_seconds_bucket[72h])) by (le))'`
  - `toolkit gf query 'sum(increase(pr_review_inline_comments_total[72h])) by (outcome)'`
  - `toolkit gf query 'sum(increase(pr_review_status_comments_total[72h])) by (state)'`
  - Pass: there is activity for recent PRs; p95 latency is below the 480 second SLO; failures/skips are explainable.
  - Evidence: `pr_review_count_total` showed approximately 24 posted and 2 failed over 72h; p95 latency was about 109s, below the 480s SLO; inline/status metrics were populated.

- [ ] Nightly PR-review eval is running and not regressing.
  - `temporal schedule describe --schedule-id pr-review-eval-nightly`
  - `toolkit gf query 'pr_review_eval_regression_active'`
  - `toolkit gf query 'sum(increase(pr_review_eval_runs_total[72h])) by (outcome)'`
  - Pass: nightly runs complete, precision/recall metrics exist, and no unexplained regression alert is active.
  - Evidence: failed. `pr-review-eval-nightly-workflow-2026-05-22T11:00:00Z` failed immediately because `PR_REVIEW_FIXTURES_REPO_URL` is missing. `pr_review_eval_regression_active` was 0, but the run itself failed.

## Scout Data Dragon

- [x] Version-check and weekly-refresh schedules still fire with the intended cadence.
  - `temporal schedule describe --schedule-id scout-data-dragon-version-check`
  - `temporal schedule describe --schedule-id scout-data-dragon-weekly-refresh`
  - Pass: Sunday-Friday version check and Saturday forced refresh are intact.
  - Evidence: version-check is `0 6 * * 0-5`, weekly-refresh is `0 6 * * 6`; 2026-05-22 version-check workflow completed.

- [ ] Image-only changes are suppressed into email instead of noisy PRs.
  - Check recent Data Dragon runs and GitHub PRs.
  - Pass: existing-image-only diffs produce a Postal email with reason/version/count, and no PR is opened for that case.
  - Evidence: not proven in this window; latest/current Data Dragon version was `16.10.1`, so no image-only diff occurred.

- [ ] Non-image-only changes still open PRs.
  - Pass: data/config/source changes, added/removed/renamed/copied images, or untracked images still create reviewable PRs.
  - Evidence:

## LLM Observability

- [x] Temporal LLM calls create Tempo traces.
  - Check `pr-summary`, `deps-summary`, and agent-task/homelab audit spans if applicable.
  - Pass: spans include service name `temporal`, useful operation names, and no secret values.
  - Evidence: worker logs for PR #864 summary include `traceId=ecac45c6afda175f20058a18bebfee96` and `spanId=b9cf5d36c0ce8509`.

- [ ] Archive objects are created for captured LLM calls.
  - Check the configured `llm-archive` bucket/path.
  - Pass: objects exist for recent Temporal calls, are gzip-readable, and contain redacted request/response payloads.
  - Evidence: not verified; S3/SeaweedFS archive bucket was not checked in this run.

- [x] Provider-side failures page through metrics, not high-cardinality Bugsink issues.
  - `toolkit gf query 'sum(increase(ai_provider_errors_total{app="temporal"}[72h])) by (provider,kind,source)'`
  - `toolkit gf query 'max(ai_provider_issue_active{app="temporal"}) by (provider,kind,source)'`
  - Pass: expected provider failures are visible in metrics/alerts; Bugsink does not create noisy duplicate provider issues.
  - Evidence: Prometheus reported active `ai_provider_issue_active{app="temporal", provider="anthropic", kind="rate_limit", source="pr_review_specialist"} = 1`; PagerDuty incident #4840 was created. Bugsink did not show a new provider-error issue class, but the active provider issue still needs remediation.

## Error Tracking And Alerts

- [ ] Bugsink has no unresolved new Temporal issue class from the deploy.
  - `toolkit bugsink issues --project temporal`
  - Pass: no new unresolved issue class, or every issue has a concrete owner/fix.
  - Evidence: unresolved Temporal Bugsink issue remains: `HaWebSocketError: WebSocket failed to open`, 5 events, last seen 2026-05-19 08:54:54.

- [ ] PagerDuty/Alertmanager are quiet for the intended fixes.
  - Check active firing alerts and PD incidents for Temporal, PR-review bot, provider health, and homelab audit.
  - Pass: no active incident caused by the new Temporal worker, schedules, API, archive, or PR review changes.
  - Evidence: failed for provider health. PagerDuty incident #4840 is active for Temporal Anthropic rate limits. Other active homelab incidents were also present but not direct Temporal deploy regressions.

- [ ] Logs have no repeated secret, auth, rate-limit, webpack, or bundle errors.
  - Query Loki for `namespace="temporal"` and components `agent-task-api`, `agent-task`, `pr-webhook`, `pr-agent`, `pr-summary`, `ha-presence`.
  - Pass: no repeated stacktrace pattern; logs redact tokens and secrets.
  - Evidence:

## Documentation And Closure

- [ ] Update plan statuses based on this checklist.
  - `packages/docs/plans/2026-05-17_temporal-agent-task-scheduler.md`
  - `packages/docs/plans/2026-05-17_homelab-audit-tooling-gaps.md`
  - `packages/docs/plans/2026-05-19_llm-observability.md`
  - Pass: if live verification is green, mark complete and archive completed plans with `git mv`.
  - Evidence:

- [ ] Record any misses as concrete follow-ups.
  - Pass: each failed checkbox has either a linked issue/PR, a new plan/log entry, or a `temporal-agent-task` report-only follow-up block if it should be checked later.
  - Evidence:

## Session Log — 2026-05-22

### Done

- Created this checklist from the deployed Temporal workstreams documented in recent plans, logs, source files, and recall history.
- Included concrete checks for live Temporal schedules, emails, S3 archives, agent-task ingress auth, PR review behavior, Data Dragon suppression, LLM observability, Bugsink, PagerDuty, and closure docs.
- Ran the first live checklist pass for the 72h bake window and recorded pass/fail evidence above.

### Remaining

- Fix the failed items from the 2026-05-22 run before marking the Temporal plans complete.
- Re-run the checklist after fixes and archive completed plan docs once the live evidence is green.

### Caveats

- Some checklist items are intentionally not verified because prerequisite checks failed first, especially audit email/archive and authenticated test task creation.
- Metrics query windows use `72h` as a default bake window. Adjust to the actual deployment timestamp when rerunning the checklist.
