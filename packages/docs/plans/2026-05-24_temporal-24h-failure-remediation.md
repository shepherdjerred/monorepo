# Temporal 24h Failure Remediation

## Status

Partially Complete

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

## Session Log — 2026-05-24

### Done

- Confirmed `ghcr.io/shepherdjerred/temporal-worker:latest` resolves to `2.0.0-2752@sha256:1cf5b8e1f19a119409f3d613d612f078b58935bcde31c731aaef83daa1262188`.
- Confirmed image commit `4ea81a85194099597623ae2766ff09baca05c8b4` is on `origin/main` and contains hardening commit `d1bbeae26244`.
- Updated `packages/homelab/src/cdk8s/src/versions.ts` so `shepherdjerred/temporal-worker` points at `2.0.0-2752@sha256:1cf5b8e1f19a119409f3d613d612f078b58935bcde31c731aaef83daa1262188`.
- Temporarily patched the live Kubernetes secret `temporal/temporal-temporal-worker-1p` with `PR_REVIEW_FIXTURES_REPO_URL=https://github.com/shepherdjerred/monorepo-pr-review-fixtures.git`.
- Attempted to roll the live Deployment image directly with `kubectl set image`; ArgoCD/Helm reconciliation returned the Deployment to the chart-rendered `2.0.0-2635` image, so the durable rollout must go through the version pin and chart publish path.
- Verified `packages/homelab` with `bun run typecheck` and `bun run test`.

### Remaining

- Add `PR_REVIEW_FIXTURES_REPO_URL` permanently to 1Password item `vaults/v64ocnykdqju4ui6j6pua56xw4/items/mjgnqqh37jxyzseqrddde2jgaq`; the local `op` session was not signed in, so only the Kubernetes secret was patched temporarily.
- Merge and publish the homelab version pin so the Temporal Helm chart renders the `2.0.0-2752` worker image and ArgoCD applies it.
- Rerun Temporal package typecheck, lint, and focused tests once the workspace dependencies can be installed in this environment.
- After the new worker image and permanent secret are live, run the requested workflow acceptance checks for PR eval fixtures, Data Dragon region config, oversized PR summary, symbol-index parse fallback, homelab audit timeout bounds, and last-24h failure recurrence.

<!-- temporal-agent-task
{
  "title": "Recheck Temporal 24h failure remediation rollout",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-24T18:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/plans/2026-05-24_temporal-24h-failure-remediation.md"
  },
  "prompt": "Check the Remaining section of the Temporal 24h failure remediation plan. Report whether the 1Password fixture URL is configured, the Temporal worker is running image 2.0.0-2752, pr-review-eval-nightly is unpaused, and no new failures have appeared from the five documented failure classes. Email a concise status report with links or command evidence."
}
-->

### Caveats

- Temporal package verification is blocked locally because required workspace and package dependencies are missing and the sandbox cannot download the remaining tarballs without approval.
- The direct Kubernetes secret patch is not durable. The 1Password Operator may overwrite it until the 1Password item field is added.
- The direct Deployment image patch did not persist because the GitOps source still renders `2.0.0-2635`.

## Final Summary

Status remains partially complete: the repository-side image pin is ready for
review, and homelab validation passed, but the permanent 1Password update,
GitOps rollout, and live workflow acceptance checks still need to happen after
this change is merged and deployed.
