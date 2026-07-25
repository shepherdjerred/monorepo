---
id: log-2026-06-12-alloy-psa-argocd-drift
type: log
status: complete
board: false
---

# Cluster health check → alloy PSA fix + minecraft Application drift fix

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

## Lockdown switch (2026-06-12 late evening) — owner approved, executed, verified

Owner chose to relax kernel lockdown to `integrity`. Execution notes:

1. Added `[-lockdown, lockdown=integrity]` to `src/talos/image.yaml`, regenerated schematic via `update-image-id.ts` → `ef9feacc2b73…`, refreshed the (stale) installer digest from the factory registry.
2. **`talosctl upgrade` gotcha #1**: a `repo:tag@digest` image reference fails — containerd pulls by digest but the installer looks up `tag@digest` in the store and misses ("not found in containerd store"). Use the tag-only reference.
3. **`talosctl upgrade` gotcha #2**: the upgrade's node drain deadlocked on the postgres-operator's PDBs (`minAvailable: 1` on 1-replica postgres clusters in bugsink/temporal/plausible — can never be satisfied on a single node). The drain timed out, the upgrade aborted safely, and **the node was left cordoned** with evicted pods Pending. Fixed by deleting the 6 PDBs by hand and retrying; permanent fix in code: `configKubernetes.enable_pod_disruption_budget: false` on the postgres-operator (also covers a 4th PDB pair in `prometheus/postgres-grafana-*`).
4. Upgrade succeeded; node booted `7c20468c…` with lockdown `[integrity]`. Talos did NOT auto-uncordon (cordon predated the successful upgrade attempt) — manual `kubectl uncordon torvalds`.
5. **End-to-end verified**: alloy 2/2, eBPF tracer loads, 0 push errors, ArgoCD alloy app **Healthy** (first time ever), and Pyroscope `LabelValues` returns `service_name` entries for every workload on the node (birmel, streambot, dagger-engine, kube-apiserver, …).

## Session Log — 2026-06-12

### Done

- Health check of Talos / K8s / ArgoCD (all findings above).
- PR [#1126](https://github.com/shepherdjerred/monorepo/pull/1126): alloy namespace PSA labels; minecraft `ignoreDifferences` drift fix; `sysctls.yaml` Talos patch (kptr_restrict=1); alloy chart bump 1.8.2 → 1.10.0; Talos image schematic with `lockdown=integrity` (+ refreshed digest); postgres-operator `enable_pod_disruption_budget: false`; Talos README docs.
- All of it applied live and verified: node upgraded/rebooted to the new image, alloy eBPF profiling works end-to-end into Pyroscope, ArgoCD alloy app Healthy.

### Remaining

- Merge #1126. Post-merge: `apps` goes Synced (live alloy targetRevision already 1.10.0); the operator deletes the remaining `prometheus/postgres-grafana-*` PDBs once the disabled-PDB config syncs.
- **mcp-gateway still Degraded** (missing `FASTMAIL_TOKEN` key in `mcp-gateway-credentials`, ~4.7 days) — separate fix needed.
- bugsink/plausible/temporal showed Degraded briefly post-reboot (pods all Running; ArgoCD health lagging) — expected to self-clear; re-check if not.

### Caveats

- Kernel hardening posture changed deliberately: lockdown confidentiality → integrity and kptr_restrict 2 → 1, both to enable eBPF profiling. Revert = remove the two extraKernelArgs from image.yaml + sysctls.yaml, regen schematic, upgrade.
- The first upgrade attempt's abort left the node cordoned with most workloads evicted — that's the failure mode if a drain-blocking PDB ever reappears.
- First drift diagnosis blamed the API server for dropping `group: ""`; live prometheus disproved that (real cause: ArgoCD Go `omitempty` round-trip).
- Alloy was Progressing since 2026-06-08 with zero pods and nothing alerted — a DaemonSet desired>0/current=0 or app Progressing >1h alert may be worth adding.
