---
id: log-2026-07-09-talos-k8s-patch-upgrade-1-13-6
type: log
status: complete
board: false
---

# Update Talos on `torvalds` (v1.13.5 → v1.13.6)

## Context

Renovate opened two PRs bumping the pinned `siderolabs/talos` version to v1.13.6 (#1426
dependency, #1427 `ghcr.io/siderolabs/installer` docker tag). Per repo convention
(`renovate.json` "Critical infrastructure — no delay, no automerge" group), these pins are
notify-only — the actual upgrade on the single-node `torvalds` cluster is a manual,
deliberate operation, mirroring the procedure already run in
`packages/docs/archive/completed/2026-05-12_talos-k8s-upgrade.md` and
`2026-05-26_talos-k8s-patch-upgrade.md`.

Live cluster was confirmed on v1.13.5 as of 2026-07-08
(`packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md`). No Kubernetes
version bump was pending alongside this (stayed at v1.36.2). No schematic regeneration was
needed — system extensions/kernel args in `packages/homelab/src/talos/patches/image.yaml`
were unchanged, so `update-image-id.ts` didn't need to run; only the version tag + digest
changed.

## Steps executed

### 1. Pre-flight

`talosctl health` on `torvalds.tailnet-1a49.ts.net` reported fully green (etcd, apid, kubelet,
control plane, k8s nodes all OK). `kubectl get pods -A` showed a handful of non-Running pods,
none of which were reboot zombies: pre-existing crashloops (1Password Connect, chartmuseum,
gickup, golink, mc-router, media-qbittorrent/recyclarr/seerr, nfd, openebs, kube-state-metrics,
temporal-ui — all aged 3-4 days, predating this session) and transient buildkite CI runner
pods cycling normally. Left untouched as out of scope.

### 2. Resolve new installer digest

```bash
crane digest factory.talos.dev/metal-installer-secureboot/4560d31e3c529f9808e0898c2804d25be14201992fe2792abd4a09618e0d39a9:v1.13.6
# sha256:a47913d0a4eb0c3174611a16f1e1b026a5091322b072f54a26cf698416056805
```

### 3. Talos upgrade

```bash
IMAGE=factory.talos.dev/metal-installer-secureboot/4560d31e3c529f9808e0898c2804d25be14201992fe2792abd4a09618e0d39a9:v1.13.6
talosctl --nodes torvalds.tailnet-1a49.ts.net upgrade --image "$IMAGE" --drain=false
```

Reboot completed cleanly. Post-reboot: kernel `6.18.38-talos`, containerd `2.2.5`, node
`Ready`.

### 4. Post-reboot verification

- `talosctl version` — Server Tag `v1.13.6` ✓
- `kubectl get nodes -o wide` — VERSION `v1.36.2`, OS-IMAGE `Talos (v1.13.6)`, kernel
  `6.18.38-talos` ✓
- `talosctl health` — all OK ✓
- No new zombie pods from this reboot beyond the pre-existing/unrelated set noted above ✓

### 5. Repo pins

| File                                              | Change                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/homelab/src/cdk8s/src/versions.ts:191`  | `"siderolabs/talos": "1.13.5"` → `"1.13.6"`                          |
| `.dagger/src/constants.ts:159`                    | `TALOSCTL_VERSION = "v1.13.5"` → `"v1.13.6"`                         |
| `packages/homelab/src/talos/patches/image.yaml:8` | `:v1.13.5@sha256:2dfcf280...` → `:v1.13.6@sha256:a47913d0...`        |
| `packages/homelab/README.md:207`                  | stale example `VERSION=v1.13.4` → `v1.13.6` (missed in a prior bump) |

### 6. Renovate PRs

PRs #1426 and #1427 are superseded by this PR (same version bumps plus the digest + README
fix they don't carry) — close both directly rather than merging.

## Caveats

- `--drain=false` remains mandatory on this single-node cluster (default drain hangs on
  postgres-operator PDBs) — same lesson as the 2026-05-26 session.
- The README's Talos upgrade example was one patch behind (`v1.13.4`) before this fix —
  worth double-checking the README diff lands in every future patch-bump PR.

## Session Log — 2026-07-09

### Done

- Talos `v1.13.5 → v1.13.6` applied to `torvalds` via `talosctl upgrade --image ...:v1.13.6 --drain=false`. Kernel now `6.18.38-talos`; containerd `2.2.5`.
- Updated repo pins: `versions.ts`, `.dagger/src/constants.ts`, `image.yaml` (new digest), `README.md` (also fixed stale `v1.13.4` example).
- Mirrored harness plan `~/.claude/plans/let-s-plan-this-update-sunny-snail.md` into this log.

### Remaining

- Close Renovate PRs #1426 and #1427 once this PR merges.
- Open PR from `chore/talos-upgrade-1.13.6` branch (worktree `.claude/worktrees/talos-upgrade-1.13.6`).

### Caveats

- Per user instruction, no separate heavy build/typecheck command was run manually; the
  `homelab-typecheck`/`homelab-helm-lint`/`talos-schematic-sync` pre-commit hooks ran as part
  of committing (their dependency installs are scoped to `src/cdk8s`/`src/helm-types`, not a
  full monorepo `scripts/setup.ts`) and all passed, including the 256-test cdk8s suite.
