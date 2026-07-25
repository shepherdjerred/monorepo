---
id: reference-completed-2026-06-06-cancel-buildkite-builds-on-pr-close
type: reference
status: complete
board: false
---

# Cancel Buildkite builds when a PR is closed/merged

## Context

When a PR is merged or closed, its in-flight Buildkite builds keep running to
completion, wasting CI capacity (the homelab BK agents are quota-capped via
Kueue, so a wasted build delays real work). This adds a Temporal workflow that
listens for GitHub PR `closed` events (merge **or** plain close) and cancels any
still-active Buildkite builds for that PR's branch.

The existing Temporal worker already provided the plumbing: an HMAC-verified
GitHub `pull_request` webhook server (`/webhook`, port 9466) that previously
ignored the `closed` action, and `BUILDKITE_API_TOKEN` /
`BUILDKITE_ORGANIZATION_SLUG=sjerred` / `BUILDKITE_PIPELINE_SLUG=monorepo` in its
env. No new ports, services, ingress, or webhook subscriptions were required.

### Decisions (from user)

- **Token**: reuse the existing `BUILDKITE_API_TOKEN`, upgrading its scope to add
  `write_builds` (read-only today).
- **Bot PRs**: cancel builds for **all** closed/merged PRs, including
  bot-authored (Renovate).

## Approach (as built)

Webhook `closed` action → `cancelBuildkiteBuildsWorkflow` on the `DEFAULT` queue
→ one activity lists active builds for the branch and cancels each via the
Buildkite REST API. Routing through Temporal gives durable retries if the BK API
is flaky.

- `cancelBuildkiteBuildsForBranch` activity lists builds filtered by
  `branch=<head.ref>` and active states only
  (`creating/scheduled/running/blocked/canceling`), then issues
  `PUT .../builds/{n}/cancel` per build. A 4xx on cancel (build finished between
  list and cancel) is a benign skip; a 5xx throws so Temporal retries; a 401/403
  throws a `write_builds`-scope-specific error.
- The webhook handler delegates the `closed` action to `handleClosedPr`
  (`src/event-bridge/pr-closed.ts`), which builds the input and starts the
  workflow with an idempotent id
  (`cancel-bk-builds-{owner}-{repo}-{pr}-{sha}`, `REJECT_DUPLICATE`). It does not
  skip draft or bot PRs.

## Files

| File                                                               | Change                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `packages/temporal/src/shared/schemas.ts`                          | + `CancelBuildkiteBuildsInputSchema` / type                         |
| `packages/temporal/src/activities/cancel-buildkite-builds.ts`      | **new** activity (+ injectable-fetch impl)                          |
| `packages/temporal/src/activities/cancel-buildkite-builds.test.ts` | **new** activity tests                                              |
| `packages/temporal/src/activities/index.ts`                        | spread new activity group                                           |
| `packages/temporal/src/workflows/cancel-buildkite-builds.ts`       | **new** workflow                                                    |
| `packages/temporal/src/workflows/index.ts`                         | re-export wrapper                                                   |
| `packages/temporal/src/event-bridge/pr-closed.ts`                  | **new** — start helper + `handleClosedPr`                           |
| `packages/temporal/src/event-bridge/github-webhook.ts`             | route `closed` → `handleClosedPr`; extract signature-verify helper  |
| `packages/temporal/src/event-bridge/github-webhook.test.ts`        | new "PR closed" describe block; drop stale "closed is ignored" test |

## Verification

- `bun run typecheck` — clean.
- `bunx eslint <changed files>` — clean.
- `bun test src/activities/cancel-buildkite-builds.test.ts
src/event-bridge/github-webhook.test.ts src/workflows/bundle.test.ts` — 23/23
  pass (bundle test proves the new workflow registers on the worker).
- Manual end-to-end (post-deploy, after token scope upgrade): open a throwaway
  PR, let a build start, close it, confirm the build moves to
  `canceled`/`canceling` via the BK API and the worker logs the
  `cancel-bk-builds complete` line.

## Session Log — 2026-06-06

### Done

- Implemented the full feature on branch `claude/determined-chatelet-a538f3`:
  schema, activity (+tests), workflow, index wiring, and webhook `closed`
  routing (files table above).
- Extracted `handleClosedPr` + `startCancelBuildkiteBuilds` into
  `src/event-bridge/pr-closed.ts` and a `verifyWebhookSignature` helper to stay
  within the package's complexity/max-lines lint budgets.
- typecheck clean, lint clean on all changed files, 23 targeted tests pass
  including the workflow-bundle smoke test.

### Remaining

- **Out-of-band**: add `write_builds` scope to the 1Password
  `BUILDKITE_API_TOKEN` (item `mjgnqqh37jxyzseqrddde2jgaq`). Until then the
  cancel `PUT` returns 403 and the activity throws (Temporal retries, then
  surfaces the failure).
- Deploy the temporal worker image (normal GitOps flow) so the new webhook
  routing + workflow are live, then run the manual end-to-end check.
- No code change to `packages/homelab/.../temporal/worker.ts` was needed — the
  token, org, and pipeline env vars are already wired.

### Caveats

- Cancellation is keyed on **branch**, not PR number (BK builds carry the
  branch; the `meta_data[pull_request]` filter is less reliable). One branch ↔
  one PR holds for this repo's flow.
- The full `bun test` run shows 4 unrelated pre-existing failures: 3 `temporal
integration` tests that need a live Temporal dev server, and 1
  `register-schedules` test for `alert-remediation-hourly`. The schedules /
  alert-remediation sources are byte-identical to `origin/main`, and the new
  workflow is webhook-triggered (not in `SCHEDULES`), so none are caused by this
  change.
- The worktree also shows codegen-artifact churn (`helm/index.ts`,
  `loki.types.ts`, `sjer.red/bun.lock`) from running `scripts/setup.ts`; not part
  of this feature — stage only the files in the table when committing.
