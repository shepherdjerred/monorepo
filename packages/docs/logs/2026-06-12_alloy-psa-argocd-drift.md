# Cluster health check → alloy PSA fix + minecraft Application drift fix

## Status

Complete (pending PR merge + chart publish)

## Context

Session started as a health check of ArgoCD / Kubernetes / Talos, then fixed the two real issues found (PR [#1126](https://github.com/shepherdjerred/monorepo/pull/1126)).

## Health check findings (2026-06-12)

- **Talos**: fully healthy — all `talosctl health` checks pass, machine stage `running`, client cert valid until 2027-04. Talos v1.13.3 / K8s v1.36.1.
- **Node**: `torvalds` rebooted ~16:30 PT (boot id `7d4940aa`). `Unknown`-status pods (jellyfin, plex, streambot, mario-kart, pokemon) were stale pre-reboot pods; all had Running replacements within minutes.
- **buildkite Error pods**: cancelled CI job (build 3743) agents receiving SIGTERM — transient, not a cluster issue.
- **mcp-gateway Degraded** (separate, NOT fixed here): `CreateContainerConfigError` for 4.5+ days — `couldn't find key FASTMAIL_TOKEN in Secret mcp-gateway/mcp-gateway-credentials`. ~30k kubelet retries. Needs the 1Password item / OnePasswordItem field reconciled.

## Issue 1 — alloy DaemonSet never started (fixed)

- DaemonSet `alloy` (eBPF profiling → Pyroscope) had **0/1 pods since deploy (~4d20h)**. ArgoCD app stuck `Progressing`.
- PodSecurity admission rejected every pod: `violates PodSecurity "baseline:latest": host namespaces (hostPID=true), privileged`.
- Cause: the app used only `CreateNamespace=true`, which creates a bare namespace; the cluster-default `baseline` PSS then blocks the intentionally-privileged pod. buildkite/velero/media avoid this with explicit `pod-security.kubernetes.io/enforce: privileged` namespace labels.
- Fix: explicit `Namespace` with privileged PSA labels in `packages/homelab/src/cdk8s/src/resources/argo-applications/alloy.ts`, matching `buildkite.ts`.
- Consequence of the bug: **Pyroscope received no eBPF profiles for the entire life of the alloy app.**

## Issue 2 — perpetual OutOfSync on `apps` (fixed)

- Only drift in the whole cluster (swept all 64 apps' resources): the `minecraft-sjerred` / `minecraft-shuxin` / `minecraft-tsmc` Application CRs.
- Diff: git declares `group: ""` on the Service `ignoreDifferences` entry; live CR lacks it.
- Mechanism (verified, subtle): the API server does **not** drop `group: ""` — live `prometheus` still has it. ArgoCD's Application Go types mark `group` as `omitempty`, so a write that round-trips through the ArgoCD API (UI edit, `argocd app set`, etc.) strips it. Only the three minecraft CRs had been rewritten that way.
- Fix: omit `group` entirely (missing == core API group), so git matches the normalized live form. Other apps that render `group: ""` (e.g. prometheus) were left alone — they aren't drifting.

## Verification

- `tsc --noEmit`, eslint, full pre-commit suite (helm lint, cdk8s tests) all green.
- cdk8s synth inspected: alloy Namespace renders with the 3 PSA labels (same shape as buildkite's); minecraft Application specs render without `group: ""`.

## Live testing (2026-06-12 evening) — onion peeled, three layers deep

User asked to apply the fix live to test. Result: the PSA fix works, but alloy eBPF profiling is blocked by Talos kernel lockdown and **cannot work on this node without a Talos image change**.

1. **PSA labels** (`kubectl label ns alloy pod-security.kubernetes.io/...=privileged` ×3): daemonset-controller was in a long failure backoff; nudged with a temporary DS annotation (since removed). Pod scheduled and ran 2/2. ✅ PSA fix verified.
2. **Next blocker — kallsyms**: `failed to read kernel symbols: unable to read kallsyms addresses`. Talos KSPP default `kernel.kptr_restrict=2` hides kallsyms from everyone (capabilities cannot bypass 2). Added `packages/homelab/src/talos/patches/sysctls.yaml` setting it to `1` (CAP_SYSLOG holders can read; alloy is privileged). Applied live via `talosctl patch machineconfig` (no reboot). ✅ kallsyms error gone.
3. **Next blocker — BPF verifier**: `program of this type cannot use helper bpf_probe_read#4`. Tested alloy chart 1.10.0 / app v1.17.0 (latest) live by patching the Application targetRevision — same error. Root cause (per falcosecurity/libs#2736, same Talos symptom): the SecureBoot Talos image boots with **kernel lockdown=confidentiality**, which disables `bpf_probe_read*()` kernel-memory helpers entirely. No alloy version can work under it.
4. Fix per the Falco thread + siderolabs/talos#8535: regenerate the factory.talos.dev schematic with `extraKernelArgs: [-lockdown, lockdown=integrity]`, run `update-image-id.ts`, `talosctl upgrade` (node reboot). **Decision left to owner** — it relaxes kernel hardening and reboots the single-node cluster.

Live state at session end: alloy ns has PSA labels, node has `kptr_restrict=1`, live alloy Application targetRevision=1.10.0 (matches the versions.ts bump in the PR, so no drift post-merge). Alloy pod Running but `pyroscope.ebpf` component unhealthy (lockdown).

## Session Log — 2026-06-12

### Done

- Health check of Talos / K8s / ArgoCD (all findings above).
- PR [#1126](https://github.com/shepherdjerred/monorepo/pull/1126) (`fix/alloy-psa-and-argocd-drift`): alloy namespace PSA labels, removal of `group: ""` from three minecraft `ignoreDifferences`, `sysctls.yaml` Talos patch (kptr_restrict=1, applied live), alloy chart bump 1.8.2 → 1.10.0 (matches live), Talos README docs.
- Live-verified: PSA fix works (pod schedules/runs); minecraft drift fix needs no live action (live CRs already lack `group: ""`).

### Remaining

- **Owner decision**: change Talos kernel lockdown confidentiality → integrity (new image schematic + `talosctl upgrade` + reboot) to make alloy eBPF actually profile, or park/remove alloy. Until then the alloy app stays Progressing with an unhealthy `pyroscope.ebpf` component.
- Merge #1126; post-merge confirm `apps` goes Synced and alloy stays as live-tested.
- **mcp-gateway still Degraded** (missing `FASTMAIL_TOKEN` key in `mcp-gateway-credentials`) — separate fix needed, not in scope of this PR.

### Caveats

- The rendered Namespace carries `namespace: argocd` metadata (chart default); harmless for cluster-scoped resources and identical to the working buildkite pattern.
- First fix attempt blamed the API server for dropping `group: ""`; live prometheus disproved that. Comments/PR describe the real omitempty round-trip mechanism.
- `kptr_restrict=1` is a (mild) hardening relaxation that currently buys nothing while lockdown blocks eBPF; trivially revertible (`talosctl patch` back to "2" + delete sysctls.yaml) if alloy is dropped instead.
- Alloy was Progressing since 2026-06-08 with zero pods and nothing alerted on it — a DaemonSet with desired>0/current=0 or an app stuck Progressing >1h may deserve an alert.
