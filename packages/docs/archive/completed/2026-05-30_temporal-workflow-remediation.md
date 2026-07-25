---
id: reference-completed-2026-05-30-temporal-workflow-remediation
type: reference
status: complete
board: false
---

# Temporal Workflow Remediation

## Summary

Implement fixes for the May 30 Temporal workflow triage, excluding Bugsink:

- Replace the `pr-review-eval-nightly` fixture clone path that tripped `simple-git`'s `GIT_ASKPASS` safety guard.
- Wire `PR_REVIEW_EVAL_DATABASE_URL` into the Temporal worker and pause PR review eval/report schedules when required config is missing.
- Bound `homelab-audit-daily` to a fast daily health check instead of a full infrastructure audit.
- Enforce 7-day Temporal namespace retention so weekly failures remain inspectable.
- Track secondary PR review quality issues separately.

## Implementation Notes

- Eval fixture loading should use direct `git` subprocesses with `GIT_ASKPASS` and token redaction.
- The weekly A/B report and nightly eval should fail closed at schedule registration when the eval database URL is absent.
- The daily homelab audit should target only alerts, PagerDuty, Temporal, Kubernetes unhealthy workloads, ArgoCD degraded/sync-error apps, and Buildkite `main` failures.
- Data Dragon is watch-only for this pass because the latest weekly refresh completed.

## Verification Plan

- `bun run --filter='./packages/temporal' test`
- `bun run --filter='./packages/temporal' typecheck`
- Homelab CDK8s synth/build or typecheck covering Temporal worker env and namespace init.
- Post-deploy manual checks for worker env, schedule behavior, and 168h retention.

## Session Log — 2026-05-30

### Done

- Replaced PR review eval fixture checkout with direct `git` subprocess calls that use `GIT_ASKPASS`, avoid `simple-git`, support pinned fixture checkout, and redact tokens in failure output.
- Added `PR_REVIEW_EVAL_DATABASE_URL` to Temporal worker secret wiring and guarded both `pr-review-eval-nightly` and `pr-review-ab-weekly-report` schedule registration when the eval DB URL is missing.
- Reworked `homelab-audit-daily` as a bounded report-only health check with a 10-minute workflow timeout, 8-minute agent timeout, low turn limit, command timeout guidance, and progress-marker prompt requirements.
- Updated Temporal namespace initialization to enforce `168h` retention after namespace health/create and to fail visibly instead of swallowing command errors.
- Added follow-up TODO docs for Anthropic 429 saturation and `web-tree-sitter` WASM instability.
- Verified with Temporal focused tests, full Temporal tests, Temporal typecheck/lint, Homelab CDK8s typecheck/build/test/lint, TODO invariant checks, and Prettier.

### Remaining

- Deploy the Temporal worker and Homelab CDK8s changes.
- Post-deploy, confirm `PR_REVIEW_EVAL_DATABASE_URL` is present in the worker environment.
- Trigger `pr-review-eval-nightly`, `pr-review-ab-weekly-report`, and `homelab-audit-daily` once to confirm clone, report, and bounded email behavior.
- Confirm `temporal operator namespace describe --namespace default` reports `168h` retention.

### Caveats

- Local package dependencies were not installed into this worktree because sandboxed package-level installs needed network access; verification used the existing package `node_modules` from the main checkout via a temporary symlink that was removed afterward.
- CDK8s commands emitted a non-fatal `mise` tracked-config warning, but typecheck, build, tests, and lint exited successfully.
