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

- [ ] Implement infrastructure, pipeline, task-cache, and dotfile changes.
- [ ] Verify local shell modes, cache concurrency, generated manifests, and scoped affected checks.
- [ ] Publish the branch only after the user's independent main fix is green.

## Session Log — 2026-07-27

### Done

- Recorded the approved implementation design.
- Added local-only Turbo defaults plus explicit remote-mode helpers for Fish, Bash, Zsh, and agent shells; applied and verified the managed local targets.
- Added Turbo cache write readiness, local-backend chart wording, bounded BuildKit GC, uv/Trivy CI cache PVCs and maintenance jobs, and an internal Playwright runner build.
- Verified the Buildkite pipeline, shell scripts, and the complete CDK8s package test suite.

### Remaining

- Land this branch after the independent main fix is green so Helm push and ArgoCD deploy the Turbo permission repair.
- After the first main run publishes `ci-playwright:latest`, switch the Playwright lanes from the public image to the internal runner in a follow-up commit; changing consumers before publication would make this branch's PR e2e job unable to pull the image.
- Verify the live Turbo service accepts writes and that CI has remote cache hits after the deployment reaches the cluster.

### Caveats

- `origin/main` currently contains the user's separate main failure; this work must not modify that fix.
- The current remote Turbo cache still returns HTTP 412 on writes until the existing fsGroup source fix is released through the green-main Helm/ArgoCD path.
