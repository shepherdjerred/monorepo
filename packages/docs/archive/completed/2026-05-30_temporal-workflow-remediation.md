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
