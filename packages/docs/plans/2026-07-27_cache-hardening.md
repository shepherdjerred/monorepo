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

## Comment Log

- 2026-07-27: User will merge the cache-hardening PR later. Keep this plan `in-progress` until the green-main release deploys the chart changes and live cache write/read verification completes.
- 2026-07-27: Published draft PR #1712; the user will merge after the independent main fix is green.
