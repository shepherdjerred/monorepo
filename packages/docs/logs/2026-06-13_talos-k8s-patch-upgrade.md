---
id: log-2026-06-13-talos-k8s-patch-upgrade
type: log
status: complete
board: false
---

# Talos 1.13.4 + Kubernetes 1.36.2 Upgrade (torvalds)

## Summary

Patch-upgraded the single-node cluster `torvalds`:

- **Talos OS:** v1.13.3 → **v1.13.4** (kernel 6.18.34, etcd v3.6.12, flannel v0.28.5)
- **Kubernetes:** v1.36.1 → **v1.36.2** (apiserver, controller-manager, scheduler, kube-proxy, kubelet)

Both are the latest available (no newer minor exists: K8s 1.37 unreleased, Talos 1.14 not out). Live upgrade run from the operator Mac over Tailscale; repo pins updated to match in a consolidated PR (supersedes Renovate PRs #1120/#1121/#1124).

## What ran (live)

1. `talosctl upgrade --nodes 192.168.1.81 --image …cb41030…:v1.13.4 --drain=false` → node rebooted to v1.13.4.
2. **Discovered a schematic regression** (see below); re-deployed the correct schematic `4560d31e…` to restore `lockdown=integrity`.
3. `talosctl --nodes torvalds.tailnet-1a49.ts.net upgrade-k8s --to 1.36.2 --endpoint https://torvalds:6443` (multiple runs — see incident) → all components on v1.36.2.
4. Force-deleted ~30 zombie pods left in `Error`/`ContainerStatusUnknown` by the reboots.

### Final verified state

- `kubectl get node torvalds`: Ready, **v1.36.2**, `Talos (v1.13.4)`, kernel `6.18.34-talos`
- `kubectl version`: Server **v1.36.2**; all control-plane + kube-proxy images `v1.36.2`
- `talosctl read /sys/kernel/security/lockdown`: `[integrity]` active
- alloy `pyroscope.ebpf` tracer loads cleanly (no more `bpf_probe_read#4` errors) — eBPF profiling restored

## Root cause: schematic drift (the reason for the second reboot)

The node's machine config pinned installer schematic `ef9feacc…` (v1.13.3, the original `lockdown=integrity` schematic). The repo `patches/image.yaml` pinned **`cb41030…`** (the 2026-06-12 CPU-perf-restore schematic). Querying the factory revealed:

- `cb41030…` extraKernelArgs: `[processor.max_cstate=2]` — **no lockdown args**
- repo `image.yaml` (current) extraKernelArgs: `[-lockdown, lockdown=integrity, processor.max_cstate=2]` → produces schematic **`4560d31e…`**

So `image.yaml` had been edited to add the lockdown override, but `update-image-id.ts` was never re-run — the pinned `cb41030…` reflected older source. Upgrading to `cb41030…` silently booted **without** the integrity override → `lockdown=confidentiality` → eBPF profiling broke. Fix: ran `update-image-id.ts` (regenerated pin to `4560d31e…@sha256:40e636…`) and deployed it; integrity restored.

## Incident: apiserver volume-mount deadlock during upgrade-k8s

`upgrade-k8s` rolled kube-apiserver, but the new static pod got stuck repeatedly on `mounted volumes=[audit config secrets]: context deadline exceeded` and never created a sandbox — a volume-manager deadlock (apiserver down → kubelet can't reconcile CSI/ZFS volumes → blocks the apiserver's own host-path mounts). The single-node control plane was down ~5 min. **Recovery:** `talosctl service kubelet restart` cleared it each time (running containers survive a kubelet restart). After the node settled, a final `upgrade-k8s` run completed cleanly because the control-plane components were already at v1.36.2 (no re-roll). Likely triggered by churn from two back-to-back reboots; not expected on a normal single-reboot patch upgrade.

### Connectivity note (for next time)

`upgrade-k8s` could not reach the apiserver at the machine-config controlplane endpoint `192.168.1.81:6443` (not routable from the Mac; only the Talos API on :50000 is). Use `--endpoint https://torvalds:6443` — `torvalds` resolves via Tailscale MagicDNS and is the only custom name in the apiserver serving cert (the FQDN and Tailscale IP are NOT cert SANs).

## Prevention (so the drift can't recur)

Added a `--check` mode to `packages/homelab/src/talos/update-image-id.ts` (dependency-free; dropped its `zod` use): it re-derives the schematic ID + digest from `image.yaml` via the factory and exits non-zero if they don't match the pin in `patches/image.yaml`. Wired in two places:

- **pre-commit** (`lefthook.yml`, `talos-schematic-sync`, glob-scoped to the two talos files)
- **CI** (`talosSchematicSyncHelper` in `.dagger/src/quality.ts` + `talosSchematicSync` func in `index.ts`; `talosSchematicSyncStep` in `scripts/ci/src/steps/quality.ts`; registered in `pipeline-builder.ts`, gated on homelab changes)

Editing `image.yaml`'s extraKernelArgs/systemExtensions without regenerating the pin now fails fast. This also catches Renovate's stale-digest tag bumps (the bug in PR #1121).

## Files changed (repo)

- `packages/homelab/src/cdk8s/src/versions.ts` — talos 1.13.3→1.13.4, k8s v1.36.1→v1.36.2
- `packages/homelab/src/talos/patches/image.yaml` — schematic `cb41030…`→`4560d31e…`, tag v1.13.4, digest `40e636…`
- `packages/homelab/src/talos/update-image-id.ts` — `--check` mode, no zod
- `packages/homelab/README.md` — upgrade snippet → v1.13.4 / 1.36.2, new schematic
- `.dagger/src/constants.ts` — TALOSCTL_VERSION v1.13.4, KUBECTL_VERSION v1.36.2
- `.dagger/src/{quality,index}.ts`, `scripts/ci/src/{steps/quality,pipeline-builder}.ts` — schematic-sync CI check
- `lefthook.yml` — `talos-schematic-sync` pre-commit hook

## Session Log — 2026-06-13

### Done

- Live: Talos → v1.13.4, K8s → v1.36.2 on torvalds; lockdown=integrity restored; eBPF profiling working; zombie pods cleaned.
- Repo: version pins, regenerated installer schematic (`4560d31e…`), README, dagger constants.
- Prevention: `update-image-id.ts --check` + pre-commit + CI wiring.
- Verified: `bun run typecheck` (homelab, scripts/ci) green; eslint clean on changed TS; pipeline-builder tests pass; `update-image-id.ts --check` reports in-sync.

### Remaining

- Open the consolidated PR and close Renovate PRs #1120 (talos), #1121 (installer, stale digest), #1124 (k8s) as superseded.
- `.dagger` typecheck can't run locally (SDK generated at CI load time); the changes are exact pattern-copies of `tunnelDnsCoverage*` and will compile in CI.

### Caveats

- `mcp-gateway` remains `CreateContainerConfigError` (missing `FASTMAIL_TOKEN` in `mcp-gateway/mcp-gateway-credentials`) — pre-existing, unrelated to this upgrade.
- The apiserver volume-mount deadlock under reboot churn is worth knowing: if `upgrade-k8s` stalls on `config version mismatch` with the apiserver unreachable, `talosctl service kubelet restart` is the recovery.
- The node's machine-config `install.image` still references the old `ef9feacc…` schematic (it isn't rewritten by `talosctl upgrade --image`); only matters on a full reinstall. The committed `patches/image.yaml` is now correct (`4560d31e…`), so a regenerated config would be right.

## Session Log — 2026-06-13 (Greptile comment fixes)

### Done

- Fixed P1 Greptile comment (`PRRT_kwDOHf4r4c6JWDMG`): `packages/homelab/README.md:219` — the `upgrade-k8s` snippet already had `--endpoint https://torvalds:6443` added in commit `28e86e928` (which was in the worktree before this session); verified the README now reads `talosctl --nodes 192.168.1.81 --endpoint https://torvalds:6443 upgrade-k8s --to $VERSION`.
- Fixed P2 Greptile comment (`PRRT_kwDOHf4r4c6JWDMV`): `packages/homelab/src/talos/update-image-id.ts:23` — expanded the comment on `parseSchematicId` to explicitly note the intentional AGENTS.md deviation (manual `typeof` guards instead of Zod, justified because the script must run without `bun install` in the CI quality container). Commit `f72bc3723`.
- All hooks passed (prettier, eslint-homelab, quality-ratchet, homelab-typecheck, homelab tests).
- Pushed both commits; remote advanced from `b504ef71c` to `f72bc3723`.
- Resolved both Greptile threads via GraphQL mutation (both now `isResolved: true`).

### Remaining

- Nothing; PR #1145 greptile comments are addressed.

### Caveats

- The pre-commit `eslint-homelab` step requires `jiti` installed and `eslint-config` built; a fresh worktree will fail on first attempt without `bun install` in homelab and building `packages/eslint-config`. This session hit that on the first commit attempt (solved by installing deps then rebuilding eslint-config).
