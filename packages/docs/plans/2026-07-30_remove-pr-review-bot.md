---
id: plan-2026-07-30-remove-pr-review-bot
type: plan
status: in-progress
board: true
verification: agent
disposition: active
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
`lib/pr-summary-comment.*`, `lib/diff-slicing.*` (orphaned), the event-bridge
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

**Docs** — rewrote the temporal AGENTS.md PR section, updated the LIVE
temporal-worker architecture doc, added a superseding note to the security-hardening
decision, archived the pr-babysit plan + two babysit todos as complete.

## Verification

- `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal` — green.
- `github-webhook.test.ts` + `bundle.test.ts` — pass (webhook keeps push/conflict/closed; no missing workflow types).
- `@homelab/cdk8s` typecheck + build (synth) + `dashboard-query-health.test.ts` — green.
- `tofu -chdir=github validate` — valid.
- `bun run check-todos` — 1039 docs OK.
- Remaining before merge: full `bun run verify` (or let Buildkite run it), `knip` on temporal.

## Remaining

- [ ] Push the docs commit and drive Buildkite `bun run verify` on PR #1863 to green.
- [ ] Promote PR #1863 from draft to ready once CI passes.
- [ ] Post-merge: `git-spice repo sync`, remove the worktree, and archive this plan to `archive/completed/`.

## Session Log — 2026-07-30

### Done

- Branch `feature/remove-pr-bot-entirely`, draft PR #1863.
- Commit `3e8fb56c1` — temporal removal (99 files + wiring; webhook reworked).
- Commit `bd10d40e9` — homelab infra (Redis, dashboards, alerts, env, tofu).
- Docs commit (this) — AGENTS.md, architecture, decisions, board items, session plan.

### Remaining

- Push the docs commit and let Buildkite run full `bun run verify` on the PR; drive to green.
- Promote PR #1863 draft → ready after CI passes.
- Post-merge: `git-spice repo sync`, remove the worktree; archive this plan to `archive/completed/`.

### Caveats

- The GitHub webhook (`pr-bot.sjer.red`, port 9466, `GITHUB_WEBHOOK_SECRET`, tofu webhook) is **deliberately kept** — it is load-bearing for the merge-conflict check + PR-closed build cancellation, which are NOT part of the removed bot.
- `lib/pr-review-workdir.ts` is a **survivor** (used by agent-task); the name is legacy but it was intentionally not renamed to avoid churn.
- `review-signals-collect` and the CI review gate are untouched by design.
- Removing the tofu `issue_comment` event is a live GitHub webhook config change; it applies on the next `tofu apply` of the github stack.
