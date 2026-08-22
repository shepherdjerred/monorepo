---
title: About the homelab
description: Two Talos nodes with strictly separated roles, typed manifests delivered by ArgoCD, and where the single points of failure actually are.
sidebar:
  order: 1
---

The homelab is a two-node Talos Linux cluster. Everything on it is defined as
typed TypeScript — cdk8s for Kubernetes manifests, OpenTofu for the external
services around them — and delivered by ArgoCD.

```mermaid
flowchart LR
  accTitle: Homelab topology
  accDescr: A pull request builds cdk8s manifests into immutable Helm charts published to ChartMuseum. ArgoCD syncs them onto a two-node Talos cluster. Torvalds is the control plane and runs all production workloads on node-local ZFS volumes. Liskov is a CI-only worker running Buildkite step pods. Tailscale provides private ingress and Cloudflare Tunnel provides public ingress.

  PR[Pull request] --> CI[Buildkite]
  CI --> CM[ChartMuseum<br/>immutable charts]
  CM --> ARGO[ArgoCD]
  ARGO --> T[torvalds<br/>control plane + all prod]
  ARGO --> L[liskov<br/>CI only]
  T --> ZFS[(node-local ZFS)]
  TS[Tailscale] -->|private| T
  CF[Cloudflare Tunnel] -->|public| T
```

## Two nodes, deliberately unequal

**torvalds** is the control plane and the only node running production — media,
home automation, monitoring, and the storage for every prod PVC. Its ZFS volumes
are node-local, so prod stateful workloads cannot move.

**liskov** is a CI-only worker (Ryzen 9950X), tainted `ci=only:NoSchedule` in its
Talos machine config. Only Buildkite step pods, which also nodeSelector onto it,
and per-node system DaemonSets with tolerations run there.

This is not a high-availability cluster and is not pretending to be. For prod
workloads torvalds is effectively a single node: a replacement pod _is_ prod, and
there is no second node it could use.

## Why the split is worth having anyway

The value is not redundancy — it is **separating failure domains**.

If liskov is down, CI pods go Pending and nothing else notices. CI deliberately
never falls back onto torvalds, because a runaway build competing with the media
stack and home automation for CPU is worse than CI simply waiting.

If torvalds is down, everything is down, including the control plane. That is
the accepted single point of failure, and knowing it is single is more useful
than pretending otherwise.

GPU work (Intel i915 hardware acceleration) exists only on torvalds. liskov has
no GPU workloads.

## Typed infrastructure, not YAML

Manifests come from cdk8s in strict TypeScript, and Helm values are typed
against generated chart types. The committed types in
`packages/homelab/src/cdk8s/generated/helm` are the source of truth; a chart bump
that changes them without regenerating fails CI on a dedicated drift check.

The reason is that a Kubernetes manifest error usually surfaces as a workload
that quietly does not do what you meant. Pushing that into a type error moves the
discovery from "weeks later" to "before merge".

OpenTofu covers what is not in the cluster: ArgoCD bootstrap, Cloudflare,
GitHub, SeaweedFS, Tailscale, and the media stack's external config. Separate
platform stacks manage OpenAI, Anthropic, Discord, and OpenRouter organization
settings and generated credentials. OnePassword is the handoff boundary for
those credentials; application workloads never receive provider bootstrap keys.

## Delivery is GitOps, with an unusual amount of care

Charts are published immutably and synced by exact revision, not by a floating
tag. The release sequence suspends auto-sync, publishes, applies child specs
while still suspended, reconciles, and only then restores the root tree — see
[release safety](/explanation/homelab/release-safety/) for why each of those
steps exists.

Nothing is applied to the cluster by hand. A change that is not in Git does not
survive the next sync.

## Two ingress paths

Private services use a **Tailscale ingress** and are reachable only from the
tailnet. Public services go through a **Cloudflare Tunnel**.

Choosing tailnet-only is the default, and for some services the tailnet is the
entire authorization model — see
[the Scout evals trust boundary](/explanation/homelab/scout-evals-trust-boundary/)
for what that implies.

Funnel, which would publish a tailnet service to the public internet, is
deliberately never configured.

## Where state lives

Persistent volumes are ZFS on OpenEBS, across an NVMe pool and an HDD pool. They
are scrubbed weekly and covered by an explicit Velero backup inventory.

Object storage is SeaweedFS, which backs S3 buckets for Scout images, Glitter's
corpus, LLM observability archives, and public PR artifacts.

Secrets come from 1Password. Backup coverage is an explicit list, not an
inference — a volume nobody added is a volume nobody is backing up, and the
orphan audit exists to make that visible.

## CI runs here, so the homelab is in the merge path

Buildkite runs on liskov under [Kueue admission](/explanation/homelab/buildkite-admission/).
The Temporal worker also posts the required `ci/merge-conflict` status.

That means the homelab being down blocks merging. It is a real coupling, and an
accepted one.

## Related

- [Release safety](/explanation/homelab/release-safety/)
- [Buildkite admission](/explanation/homelab/buildkite-admission/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
