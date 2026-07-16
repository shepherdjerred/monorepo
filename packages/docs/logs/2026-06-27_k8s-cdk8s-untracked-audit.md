# K8s State vs cdk8s — Untracked Resource Audit

## Status

Complete — audit done **and all 5 orphans cleaned up** (2026-06-27). ~145Gi reclaimed.

## Goal

Audit the live `torvalds` cluster for anything **not tracked in cdk8s** — both whole
namespaces with no ArgoCD/cdk8s owner, and individual resources living inside
otherwise-tracked namespaces that ArgoCD does not manage.

## Method

Everything in this cluster deploys via ArgoCD (app-of-apps). ArgoCD stamps managed
objects with the `argocd.argoproj.io/tracking-id` annotation
(`<app>:<group>/<kind>:<ns>/<name>`). Detection rule for a genuine manual orphan:

> **no `argocd.argoproj.io/tracking-id` annotation AND no `ownerReferences`**

- Operator/controller children (postgres-operator, tailscale operator, cloudflare
  operator, intel device plugin, kometa cronjob, buildkite agent stack) always have an
  owner → tracked transitively if the parent CR is tracked.
- ArgoCD-applied objects always carry the tracking-id.
- The `apps:` tracking-id prefix = synthesized into the umbrella `apps` Application
  (no dedicated app), still fully tracked.

Swept: namespaces, Deployments, StatefulSets, DaemonSets, CronJobs, Jobs, bare Pods,
Services, PVCs, PVs, Ingresses, NetworkPolicies, ConfigMaps, Secrets, ServiceMonitors,
PodMonitors, PrometheusRules, Probes, CRDs, ClusterRoles, webhooks, StorageClasses,
PriorityClasses, IngressClasses, RuntimeClasses, ClusterIssuers.

## Findings — UNTRACKED

| #   | Resource                                                                              | Type            | Evidence                                                                                                                                           | Live state                                                                                                                            | Verdict                                                                            |
| --- | ------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `mk64-spike`                                                                          | Namespace       | no tracking-id, no cdk8s ref, created 2026-06-07                                                                                                   | empty                                                                                                                                 | Dead spike leftover — delete                                                       |
| 2   | `status-page` (ns + Deployment + Service + PVC + PV)                                  | namespace stack | tracking-id `status-page:…` but **no `status-page` ArgoCD app exists**; zero cdk8s references                                                      | Deployment live but restarting 18× (`status-page-api:1.1.138`); 1Gi PVC                                                               | Orphaned from a deleted ArgoCD app                                                 |
| 3   | `streambot` (ns + Deployment + Service + Ingress + 2 PVCs + spawned `ts-streambot-*`) | namespace stack | tracking-id `streambot:…` but **no `streambot` app**; superseded by tracked `media/media-streambot`                                                | Deployment scaled `0/0`; **144Gi** orphaned PVCs (`streambot-cache` 16Gi + `streambot-videos` 128Gi); tailnet ingress node still live | Orphaned — superseded by media-streambot                                           |
| 4   | `kube-system/zfs-arc-tuner`                                                           | DaemonSet       | **hand-applied**: `alpine:latest`, no tracking-id, no labels, no managedFields, created 2026-01-01                                                 | Running 1 pod                                                                                                                         | **Redundant leftover** — its `zfs_arc_max=67108864000` is now set by Talos; delete |
| 5   | `minecraft-tsmc/minecraft-tsmc-configs`                                               | ConfigMap       | legacy monolithic config (created 2026-02-01, no managedFields); superseded by tracked `minecraft-tsmc-server-configs` + `minecraft-tsmc-plugin-*` | **not mounted** by current StatefulSet                                                                                                | Dead leftover from config-split refactor — delete (unique to tsmc)                 |

### Detail: zfs-arc-tuner — REDUNDANT (already in Talos)

A DaemonSet that, per its inline script, sets `zfs_arc_max` to `67108864000` (62.5 GiB)
by writing `/host/sys/module/zfs/parameters/zfs_arc_max`, then `sleep infinity`. It
predates the Talos codification: **Talos already sets the identical value** in two places —
`src/talos/patches/zfs.yaml` (kernel module param `zfs_arc_max=67108864000` + `zfs_arc_min`)
and `src/talos/patches/image.yaml` (sysfs override `module.zfs.parameters.zfs_arc_max: "67108864000"`
plus min / meta_balance / compressed-ARC / L2ARC tuning). So the DaemonSet is dead weight,
not load-bearing — Talos enforces ARC sizing at boot. **Delete it.** (Not moved to Temporal;
moved to Talos.)

## Findings — NOT orphans (verified tracked / expected)

- `maintenance`, `node-tuning` namespaces → owned by the `apps` umbrella
  (`apps:/Namespace:…`); `node-tuning/cpu-power-cap` DaemonSet tracked by `apps`.
- `cloudflare-operator-system/homelab-tunnel` Deployment → owned by tracked
  `ClusterTunnel/homelab-tunnel` (cloudflare-tunnel app).
- `intel-device-plugin-operator/intel-gpu-plugin-gpudeviceplugin-sample` DaemonSet →
  owned by tracked `GpuDevicePlugin/gpudeviceplugin-sample`.
- Zalando postgres StatefulSets + `*-config`/`*-repl` Services (bugsink, plausible,
  grafana, temporal `-postgresql`) → spawned by tracked `postgresql` CRs.
- All `tailscale/ts-*` Services + StatefulSets → spawned by tracked Ingresses.
- All PVs → runtime-provisioned by openebs zfs-localpv (never in IaC by design); every
  PV maps to a known claim.
- kyverno validating/mutating webhooks → self-managed by tracked kyverno.
- `prometheus/{r2-exporter, kubernetes-event-exporter, nvme/smartctl/zfs collectors}` →
  tracked by `apps`.
- `kube-system` coredns / kube-proxy / kube-flannel / kube-dns, `flannel` ClusterRole,
  `system-*` PriorityClasses → Talos/k8s bootstrap (cluster infra, not cdk8s by design).
- All CRDs → belong to tracked operators/charts (ArgoCD does not stamp CRDs with a
  tracking-id; normal behavior).
- Secrets → fully clean. ServiceMonitors/PodMonitors/PrometheusRules/Probes/Ingresses/
  NetworkPolicies/StorageClasses/IngressClasses/RuntimeClasses/ClusterIssuers → fully tracked.
- `buildkite-*` / `media/kometa-*` Jobs → ephemeral, created at runtime by tracked
  controllers (buildkite agent stack, kometa cronjob).

## Remediation — EXECUTED 2026-06-27

All 5 orphans removed via live `kubectl` (nothing in git to change — these were exactly the
resources ArgoCD doesn't manage). User ran the commands; verified after:

- `mk64-spike` ns — deleted.
- `streambot` ns — deleted; its 2 PVs patched `reclaim=Retain→Delete` first, so the CSI
  driver destroyed the ZFS datasets (**144Gi** reclaimed). Tailscale operator deregistered
  the `streambot.tailnet-1a49.ts.net` device + tore down the `ts-streambot-*` resources.
- `status-page` ns — deleted; PV patched to `Delete`, dataset destroyed (**1Gi** reclaimed).
- `kube-system/zfs-arc-tuner` DaemonSet — deleted; `zfs_arc_max` still `67108864000` (Talos).
- `minecraft-tsmc/minecraft-tsmc-configs` cm — deleted; `minecraft-tsmc` StatefulSet (already
  `replicas=0`, Synced/Healthy) + its mounted `minecraft-tsmc-server-configs` cm untouched.

Verification: all 3 namespaces `NotFound`; all 3 PVs + `ZFSVolume` CRs gone; no streambot
remnants in `tailscale` ns; all ArgoCD apps `Synced/Healthy`. **~145Gi total reclaimed.**

## Original recommended remediation (for reference)

1. **`zfs-arc-tuner`** — **redundant; just delete it.** `kubectl delete ds zfs-arc-tuner -n
kube-system`. Talos (`src/talos/patches/zfs.yaml` + `image.yaml`) already sets the same
   `zfs_arc_max=67108864000` at boot, so no re-codification is needed. (It was moved to
   Talos, not Temporal.)
2. **`status-page`** — decide: re-import into cdk8s if still wanted (it's crashlooping, so
   it's likely abandoned), else `kubectl delete ns status-page` (drops Deployment, Service,
   1Gi PVC/PV).
3. **`streambot`** ns — delete; it's fully superseded by `media/media-streambot`. Frees
   144Gi of zfs-ssd and a tailnet ingress node: `kubectl delete ns streambot`.
4. **`mk64-spike`** — `kubectl delete ns mk64-spike` (empty).
5. **`minecraft-tsmc-configs`** — `kubectl delete cm minecraft-tsmc-configs -n minecraft-tsmc`
   (dead, unmounted).

## Session Log — 2026-06-27

### Done

- Read-only audit of live `torvalds` cluster vs cdk8s using the ArgoCD tracking-id +
  ownerReferences detection rule.
- Identified 5 untracked items: 3 orphan namespaces (`mk64-spike`, `status-page`,
  `streambot`) and 2 within-namespace orphans (`kube-system/zfs-arc-tuner` DaemonSet,
  `minecraft-tsmc/minecraft-tsmc-configs` ConfigMap).
- Verified all other "no-owner/no-tracking" hits are operator-spawned, bootstrap, or
  runtime-provisioned (not orphans).

- Cleaned up all 5 orphans (2026-06-27); reclaimed ~145Gi. See "Remediation — EXECUTED" above.

### Remaining

- None. Optional hardening follow-up: enable ArgoCD AppProject `orphanedResources` monitoring
  so this drift class (app deleted without prune, Retain PVs orphaned) surfaces in the UI.

### Caveats

- Detection relies on ArgoCD's tracking-id annotation; a manually-applied object that
  someone copied an ArgoCD annotation onto would read as "tracked" (none observed).
- `status-page` and `streambot` carry tracking-ids for ArgoCD apps that no longer exist —
  classic "app deleted without cascade prune" orphans; their resources will never
  self-heal or self-delete.
- zfs-arc-tuner is safe to delete: Talos already sets the identical `zfs_arc_max` via
  kernel module param + sysfs override, so removing the DaemonSet does not change ARC
  sizing. (Earlier draft wrongly called it load-bearing; corrected after checking Talos.)
