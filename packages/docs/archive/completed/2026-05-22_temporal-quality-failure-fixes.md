---
id: reference-completed-2026-05-22-temporal-quality-failure-fixes
type: reference
status: complete
board: false
---

# Temporal Quality Failure Fixes

## Context

The post-deploy Temporal quality checklist found recurring failures in `homelab-audit-daily`, `pr-review-eval-nightly`, large PR summary/review handling, tree-sitter indexing, provider rate-limit noise, and the Home Assistant event bridge Bugsink issue class.

This implementation addresses the tracked code/config side of those failures. Live closure still requires deployment, secret population, and another bake-window checklist run.

## Implemented

- `packages/temporal/src/activities/agent-task.ts`
  - Kills the spawned agent subprocess when the Temporal activity cancellation signal fires.
  - Emits stable `agent_task_runs_total{provider,outcome}` outcomes for `success`, `subprocess_failed`, `parse_failed`, `email_failed`, and `cancelled`.
  - Records subprocess duration and exit metrics for cancellation/timeout paths.
  - Moves the `success` run metric to the email-success path so runs only count successful after report delivery.

- `packages/temporal/src/schedules/register-schedules.ts`
  - Caps `homelab-audit-daily` with `maxTurns: 35`.
  - Adds prompt budget guidance requiring bounded live queries and partial reports instead of indefinite audit runs.
  - Pauses `pr-review-eval-nightly` with an explicit reason when `PR_REVIEW_FIXTURES_REPO_URL` is absent.
  - Unpauses the eval schedule when the fixture repo URL is configured.

- `packages/temporal/src/activities/pr-review/summary.ts`
  - Uses paginated `pulls.listFiles` as the PR summary diff source instead of GitHub's raw diff endpoint.
  - Adds deterministic oversized-summary mode for PRs over the file threshold or with unavailable patches.
  - Posts/updates the SDK summary comment with counts, status/extension breakdowns, top changed paths, and a clear detailed-diff-omitted note.

- `packages/temporal/src/workflows/pr-review/index.ts`
  - Treats oversized PRs as a first-class skipped lifecycle outcome before clone, tree-sitter, or specialist passes.
  - Posts a visible skipped lifecycle status and emits skipped metrics.

- `packages/temporal/src/activities/pr-review/bootstrap.ts`
  - Detects oversized PRs before workdir enrichment.
  - Logs enrichment phase details.
  - Keeps clone/auth/config failures hard for normal PRs.

- `packages/temporal/src/activities/pr-review/bootstrap-enrich.ts`
  - Degrades per-file block-diff/tree-sitter failures to line-diff fallback for that file.
  - Preserves hard failures for workdir provisioning and clone failures.

- `packages/temporal/src/lib/symbol-index.ts`
  - Degrades per-file symbol extraction failures to a warning and continues indexing other files.

- `packages/temporal/src/activities/pr-review/post-render.ts`
  - Adds `skipped` as a first-class PR review status comment state.
  - Includes reason, workflow id, and PR metadata in skipped lifecycle comments.

- `packages/temporal/src/activities/pr-review/specialists.ts`
  - Lowers specialist concurrency to reduce rate-limit pressure on Anthropic.

- `packages/temporal/src/worker.ts`
  - Moves expected HA event bridge startup retry failures out of Bugsink exception capture.
  - Emits structured logs and HA event bridge metrics instead.

- `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts`
  - Adds a Prometheus alert for sustained HA event bridge disconnection.

## Verification

- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun run lint -- --no-cache`
- `cd packages/temporal && bun test src/schedules/register-schedules.test.ts src/activities/pr-review/summary.test.ts src/activities/pr-review/bootstrap.test.ts src/activities/pr-review/post.test.ts src/activities/pr-review/metrics.test.ts`
- `cd packages/temporal && bun test`
  - Result: 464 passing tests, 3 expected local-dev-server integration failures because no Temporal dev server was listening on `127.0.0.1:7233`.
- `cd packages/homelab && bun run typecheck`
- `cd packages/homelab && bun run test`

## Blocked Verification

- PR replay commands reached GitHub App auth and stopped because `GITHUB_APP_ID` was not set in this workspace:
  - `bun run packages/temporal/scripts/replay-pr-summary.ts --repo shepherdjerred/monorepo --pr 865 --dry-run`
  - `bun run packages/temporal/scripts/replay-pr-review.ts --pr 865 --deterministic-only`
  - `bun run packages/temporal/scripts/replay-pr-review.ts --pr 863 --deterministic-only`

- Local homelab audit dry-run reached agent execution and stopped because `CLAUDE_CODE_OAUTH_TOKEN` was not set:
  - `DRY_RUN=1 bun run packages/temporal/scripts/run-homelab-audit-local.ts --sections=temporal`

- Live closure still requires:
  - Deploying the worker/homelab config changes.
  - Populating the production `PR_REVIEW_FIXTURES_REPO_URL` secret value.
  - Rerunning the Temporal post-deploy quality checklist after a bake window.
  - Confirming PagerDuty incident #4840 auto-resolves after a successful provider call path.

<!-- temporal-agent-task
{
  "title": "Rerun Temporal quality checklist after fixes deploy",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-27T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/plans/2026-05-22_temporal-quality-failure-fixes.md"
  },
  "prompt": "Rerun packages/docs/guides/2026-05-22_temporal-post-deploy-quality-checklist.md against the current deployed Temporal state. Email a pass/fail report with workflow IDs, Grafana/Prometheus evidence, PagerDuty status, Bugsink status, and any remaining blockers. Do not mutate live systems."
}
-->
