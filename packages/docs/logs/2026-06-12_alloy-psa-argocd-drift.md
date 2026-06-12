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

## Session Log — 2026-06-12

### Done

- Health check of Talos / K8s / ArgoCD (all findings above).
- PR [#1126](https://github.com/shepherdjerred/monorepo/pull/1126) (`fix/alloy-psa-and-argocd-drift`): alloy namespace PSA labels + removal of `group: ""` from three minecraft `ignoreDifferences`, with corrected root-cause comments.

### Remaining

- Merge #1126, wait for CI to publish the apps chart, then confirm: alloy DaemonSet 1/1 + app Healthy, `apps` app Synced.
- **mcp-gateway still Degraded** (missing `FASTMAIL_TOKEN` key in `mcp-gateway-credentials`) — separate fix needed, not in scope of this PR.

### Caveats

- The rendered Namespace carries `namespace: argocd` metadata (chart default); harmless for cluster-scoped resources and identical to the working buildkite pattern.
- The existing live `alloy` namespace was created bare by `CreateNamespace=true`; ArgoCD sync of the new Namespace manifest must add the labels to it. If the app doesn't recover after sync, check that the labels actually landed: `kubectl get ns alloy --show-labels`.
- First fix attempt blamed the API server for dropping `group: ""`; live prometheus disproved that. Comments/PR describe the real omitempty round-trip mechanism.
