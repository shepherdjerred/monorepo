---
id: cache-hardening
type: plan
status: in-progress
board: false
---

# Cache hardening

Implement offline-first local Turbo caching and reliable shared CI caching.

## Decisions

- Local shells and agents default to `TURBO_CACHE=local:rw`; Git worktrees share Turbo's local cache automatically.
- Developers opt into `local:rw,remote:rw` only on suitable networks; CI explicitly uses remote read/write caching.
- Keep the local-disk Turbo service, fix and test its writable PVC contract, and remove stale R2 references.
- Add bounded BuildKit GC, uv and Trivy CI caches, and a prebuilt Playwright runner.
- Preserve isolated Bun installs, per-worktree Python/Rust outputs, and Docker's existing local builder cache.

## Remaining

- [x] Implement infrastructure, pipeline, task-cache, and dotfile changes.
- [x] Verify local shell modes, generated manifests, and scoped affected checks.
- [ ] After merge, verify the live remote-cache write/read path and the first scheduled Trivy database refresh.

## Human Verification

- [ ] Merge this branch after the independent main fix is green.

## Session Log — 2026-07-27

### Done

- Recorded the approved implementation design.
- Added local-only Turbo defaults plus explicit remote-mode helpers for Fish, Bash, Zsh, and agent shells; applied and verified the managed local targets.
- Added Turbo cache write readiness, local-backend chart wording, bounded BuildKit GC, uv/Trivy CI cache PVCs and maintenance jobs, and an internal Playwright runner build.
- Verified the Buildkite pipeline, shell scripts, and the complete CDK8s package test suite.
- Opened draft PR #1712 from `feature/cache-hardening` after the affected verification passed.
- Addressed the actionable current-head review findings for PR #1712 and applied scoped review-gate remediation to PRs #1689 and #1688 in their isolated worktrees.

### Remaining

- Land this branch after the independent main fix is green so Helm push and ArgoCD deploy the Turbo permission repair.
- After the first main run publishes `ci-playwright:latest`, switch the Playwright lanes from the public image to the internal runner in a follow-up commit; changing consumers before publication would make this branch's PR e2e job unable to pull the image.
- Verify the live Turbo service accepts writes and that CI has remote cache hits after the deployment reaches the cluster.
- Submit the scoped commits and inspect the new Buildkite review-gate outcomes.
- Keep the GitOps CronJob as the durable six-hour Trivy database refresher;
  its first live reconciliation should match the manually seeded cache.

### Caveats

- `origin/main` currently contains the user's separate main failure; this work must not modify that fix.
- The current remote Turbo cache still returns HTTP 412 on writes until the existing fsGroup source fix is released through the green-main Helm/ArgoCD path.
- The Trivy database refresh is scheduled every six hours after deployment; if its shared cache is empty before the first scheduled refresh, the existing fail-fast Trivy lane will require an immediate refresh rather than silently downloading during the PR build.
- Live verification on 2026-07-27: pre-provisioned the `buildkite-trivy-db`
  5Gi RWX PVC on `zfs-ssd-lz4`, added its explicit excluded-cache classification
  to the enforced backup policy, and seeded it using the reviewed Trivy 0.72.0
  refresh command. The PVC is Bound on `liskov` and the DB download succeeded.
- The main checkout had unrelated user changes and was not modified.

## Comment Log

- 2026-07-27: User will merge the cache-hardening PR later. Keep this plan `in-progress` until the green-main release deploys the chart changes and live cache write/read verification completes.
- 2026-07-27: Published draft PR #1712; the user will merge after the independent main fix is green.
