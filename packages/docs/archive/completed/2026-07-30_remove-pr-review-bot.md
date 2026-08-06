---
id: plan-2026-07-30-remove-pr-review-bot
type: plan
status: complete
board: false
---

# Remove the PR-bot machinery from `packages/temporal` (+ homelab infra/docs)

## Context

`packages/temporal` carried the entire multi-generation PR-bot: the SOTA review
pipeline (`prReviewPipeline`), summary pipeline (`prSummaryPipeline`), the
long-running reaction-listener (`prReactionListener`, still booting in prod), and
`pr-babysit`. The review/summary bot was gated off (`PR_BOT_ENABLED=false`) and
babysit was dormant/underused, but ~120 source files, a dedicated Redis, Prometheus
rules, Grafana dashboards, cdk8s env, and a tofu webhook subscription remained. This
change rips out the whole thing in one PR (#1863), leaving zero dangling references.

### Scope decisions (locked with owner)

- **One PR**, branch `feature/remove-pr-bot-entirely`.
- **KEEP** `review-signals-collect` / `observeReviewSignalsWorkflow` / `review_*` metrics — CI-gate observability, not the bot.
- **KEEP** merge-conflict check + PR-closed build cancel + the GitHub webhook server, `GITHUB_WEBHOOK_SECRET`, port 9466, `pr-bot.sjer.red` tunnel/DNS, and the tofu webhook (drop only its `issue_comment` event). These share the webhook but are a separate active feature.
- **KEEP** the CI review GATE entirely (`@shepherdjerred/code-review`, `wait-for-review.ts`, `review-gate` step, `REVIEW_PROVIDER`).

## What was done

**Temporal (`packages/temporal`)** — deleted whole dirs (`activities/pr-review`,
`activities/pr-babysit`, `workflows/pr-review`, `workflows/pr-summary`,
`workflows/pr-reaction-listener`, `workflows/pr-babysit`, `shared/pr-review`,
`shared/pr-babysit`, `lib/pr-review`) + `observability/pr-review-metrics.*`,
`lib/pr-summary-comment.*`, `lib/diff-slicing.*` (orphaned), the orphaned
PR-review AST-analysis stack (`lib/block-diff.*`, `lib/symbol-index.*`,
`lib/symbol-retrieval.*` + tests — the only consumer was the deleted
`bootstrap-enrich.ts`) plus its now-exclusive `web-tree-sitter` +
`@vscode/tree-sitter-wasm` dependencies, the event-bridge
`start-pr-reaction-listener` / `pr-pipeline-starts` / `pr-draft-skipped-status` /
`babysit-*`, and the `replay-pr-*` / `run-pr-babysit-local` scripts. Rewrote
`github-webhook.ts` to keep only push/pull_request→merge-conflict and
closed→build-cancel (+ its test). Stripped PR wiring from `worker.ts`,
`workflows/index.ts`, `activities/index.ts`, `shared/task-queues.ts`,
`shared/schemas.ts`, `observability/metrics.ts`, `github-webhook-schema.ts`.

**Homelab (`packages/homelab`)** — removed the dedicated `temporal-redis` +
netpol/egress, PR-bot worker env (`PR_BOT_ENABLED`, `PR_REVIEW_*`, `PR_BABYSIT_*`,
`REDIS_URL`, `PR_REVIEW_LISTENER_REPOS`), the `rules/pr-review-bot.ts` +
`grafana/pr-review-bot-dashboard.ts` files, their prometheus/grafana registrations,
the `pr-bot` Prometheus rule group + `prReview|prSummary` exclusion, and the
`pr_agent_*` dashboard panels. Trimmed `issue_comment` from the tofu webhook.
**Kept** the webhook Service/tunnel/DNS/secret + port 9466, `pr_webhook_*` metrics,
and re-homed `PrWebhookSignatureFailures` into a new `github-webhook` rule group.

**Root config** — pruned the now-stale root `knip.json` exclusions that referenced
the deleted files: the seven `pr-review` `ignoreIssues` entries and the
`@vscode/tree-sitter-wasm` `ignoreDependencies` entry. Regenerated `bun.lock` after
dropping the two tree-sitter deps.

**Docs** — rewrote the temporal AGENTS.md PR section, updated the LIVE
temporal-worker architecture doc, added a superseding note to the security-hardening
decision, archived the pr-babysit plan + two babysit todos as complete. Updated the
`lib/pr-review-workdir.ts` header comment (a survivor) to drop its dangling reference
to the removed retrieval/block-diff layers.

## Verification

- `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal` — green.
- `github-webhook.test.ts` + `bundle.test.ts` — pass (webhook keeps push/conflict/closed; no missing workflow types).
- `@homelab/cdk8s` typecheck + build (synth) + `dashboard-query-health.test.ts` — green.
- `tofu -chdir=github validate` — valid.
- `bun run check-todos` — 1039 docs OK.
- `bunx turbo run typecheck test lint knip --filter=@shepherdjerred/temporal` after the analysis-stack removal — green (knip reports no dangling files/deps).
- Remaining before merge: full `bun run verify` (or let Buildkite run it).

## Remaining

- [x] Push the docs commit and drive Buildkite `bun run verify` on PR #1863 to green.
- [x] Promote and merge PR #1863 after its exact-head verification and review gates pass.
- [x] Split the privileged orphan cleanup into `todos/temporal-pr-reaction-listener-cleanup.md`. The live `prReactionListener` runs in prod under the fixed workflow ID `pr-review-reaction-listener` and continues-as-new indefinitely. Once this PR shipped, no worker polls the `PR_REVIEW` queue, so its in-flight execution became stranded in `Running` with an unprocessed workflow task. An authorized operator must terminate it (Tailscale-gated Temporal UI **Workflows → terminate**, or CLI):

  ```bash
  temporal workflow terminate --workflow-id pr-review-reaction-listener \
    --reason "pr-review reaction-listener removed (PR #1863)"
  ```

  Also terminate any still-`Running` executions of the other removed workflow types if present (`temporal workflow list --query "ExecutionStatus='Running' AND (WorkflowType='prReviewPipeline' OR WorkflowType='prSummaryPipeline' OR WorkflowType='prBabysitWorkflow')"`); in practice these are webhook-started + the bot was gated off, so there should be none.

- [x] Complete the implementation stack and archive this plan to `archive/completed/`.
