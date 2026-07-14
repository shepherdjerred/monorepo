---
id: image-size-workspace-install
status: active
origin: packages/docs/plans/2026-07-13_ci-parity-implementation.md
---

# Service images ship the whole workspace node_modules (5.4–6.4 GB)

The Phase D Dockerfiles use the single-workspace pattern (`COPY . .` +
`bun install --frozen-lockfile`) because `turbo prune` corrupts bun.lock
(banned) and the isolated linker needs every workspace package.json present.
Result: every Bun app image carries all ~5,900 packages — 5.4–6.4 GB vs the
~325 MB per-package images the old Dagger recipes produced.

Mitigations in place: the fat install layer is byte-identical across images
built from the same commit, so the registry and each cluster node store it
once (cross-image layer dedup). Still a real regression for pull-from-cold
and registry churn.

Candidate fixes (evaluate, don't assume):

- `bun install --filter <pkg>...` scoping in-image (verify it tolerates the
  full workspaces list with only target dirs present, and that Prisma
  postinstalls survive)
- a post-install prune step that deletes node_modules subtrees not reachable
  from the target package's isolated tree
- revisit if/when `turbo prune` gains sound bun.lock support upstream
