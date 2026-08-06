---
id: reference-stale-2026-05-24-temporal-24h-failure-remediation
type: reference
status: complete
board: false
---

# Temporal 24h Failure Remediation

## Summary

Remediate Temporal failures observed over the previous 24 hours by rolling the
production Temporal worker forward to an image that contains the May 23
hardening fixes, restoring the private PR review eval fixture configuration,
and verifying the affected workflow classes in production.

## Findings

- Production was pinned to `ghcr.io/shepherdjerred/temporal-worker:2.0.0-2635@sha256:b8ae933b9e584e973f089b48089fe505ef672985bdb44231f1e2657df10e9ae9`.
- GHCR `latest` for `temporal-worker` pointed at `2.0.0-2752@sha256:1cf5b8e1f19a119409f3d613d612f078b58935bcde31c731aaef83daa1262188`.
- The `2.0.0-2752` image was built from commit `4ea81a85194099597623ae2766ff09baca05c8b4`, which is on `origin/main` and contains hardening commit `d1bbeae26244`.
- The live worker secret did not contain `PR_REVIEW_FIXTURES_REPO_URL`; the correct private fixture repo is `https://github.com/shepherdjerred/monorepo-pr-review-fixtures.git`.

## Remediation Plan

- Pin `packages/homelab/src/cdk8s/src/versions.ts` to `temporal-worker` image `2.0.0-2752@sha256:1cf5b8e1f19a119409f3d613d612f078b58935bcde31c731aaef83daa1262188`.
- Add `PR_REVIEW_FIXTURES_REPO_URL` to the Temporal worker secret path. If 1Password CLI is unavailable, temporarily patch the live Kubernetes secret and record the permanent 1Password follow-up.
- Deploy through the existing homelab/ArgoCD path so the worker pod rolls to the new image.
- Verify the deployed worker has schedule pause reconciliation, oversized PR handling, symbol-index fallback, `AWS_REGION`, `AWS_DEFAULT_REGION`, and `PR_REVIEW_FIXTURES_REPO_URL`.
- Trigger targeted Temporal workflows to confirm the failure classes no longer reproduce.

## Verification Checklist

- Blocked: `cd packages/temporal && bun run typecheck`
- Blocked: `cd packages/temporal && bun run lint -- --no-cache`
- Blocked: focused Temporal tests for schedule config, PR summary oversized mode, PR review bootstrap, symbol-index fallback, and PR eval fixture loading.
- Passed: `cd packages/homelab && bun run typecheck`
- Passed: `cd packages/homelab && bun run test`
- Pending: confirm ArgoCD applies the image pin and the worker pod runs `2.0.0-2752`.
- Pending: confirm `pr-review-eval-nightly` is unpaused once the fixture URL is visible to the worker process.

## Final Summary

Status remains partially complete: the repository-side image pin is ready for
review, and homelab validation passed, but the permanent 1Password update,
GitOps rollout, and live workflow acceptance checks still need to happen after
this change is merged and deployed.
