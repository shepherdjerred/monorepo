# Homelab

[![Renovate enabled](https://img.shields.io/badge/renovate-enabled-brightgreen.svg)](https://docs.renovatebot.com/)
![ArgoCD badge](https://argocd.tailnet-1a49.ts.net/api/badge?name=apps)

This package contains everything that runs my homelab. The cluster has two
Talos Linux nodes: `torvalds` (control plane, all production workloads) and
`liskov` (CI-only worker). Services are deployed across multiple namespaces
(media, home, postal, etc.) using an app-of-apps pattern in ArgoCD.

See the [homelab overview](../docs/wiki/src/content/docs/explanation/homelab/overview.md)
for topology and the wiki how-to guides for operator workflows.
[AGENTS.md](AGENTS.md) contains only always-on package constraints.

The version catalog pins upstream dependencies and toolchains. Delivery
PostgreSQL selects first-party application images and retained worker pools.
Charts require those frozen parameters; publication binds root-owned image
dependencies to original immutable artifact records. Producer validation values
are external fixtures and never packaged deployment defaults.

## Release scheduling

The root release workflow reconciles at most three child Applications at once
within a sync wave. Every child in that wave must finish before the next wave
starts. A failed child stops new work; already-started children are observed to
completion before the error propagates. Each sync keeps its exact revision,
request ownership checks, apply-safety preflight, and workload-specific timeout
floor. Root staging, exact resource batches, and final pruning remain sequential.

Root-owned non-Application retirements use an exact prune-only resource selection
after the desired batches apply. This lets later-wave monitoring objects retire
without waiting for the root Application's own operation health. The final root
sync and all release verification still run afterward. Interrupted selections
resume only their persisted candidate inventory and exact request. An operator
may cancel an owned full-root prune through `cancelOwnedRootPrune` with fresh
Delivery authority; cancellation does not produce an applied release receipt.

Release operations are observed immediately, then every second for ten seconds,
every two seconds through thirty seconds, and every five seconds thereafter.
The cadence preserves operation deadlines and the one-minute auto-sync policy
settling budget. A release still requires restored auto-sync and its scoped
health checks before writing an applied-and-verified receipt.

After those checks, an intentionally terminated root prune also publishes
`ops.sjer.red/verified-root-release` on the root Application. A resource-version
comparison prevents annotating a concurrent operation. Ops validates the exact
request, operation, revision and timestamps before treating that termination as
verified; current Application health and subsequent failures remain visible.

Storage expansion preserves existing claim identities and retention. Woodpecker
PostgreSQL declares its quota through the database operator, and Turbo cache
declares its claim directly. Pyroscope's root-owned existing claim declares
capacity separately from the immutable Helm StatefulSet template. The root
release must expand that claim before the child reconciles; quota changes never
authorize replacing or rebinding the dataset.

## Layout

| Directory        | Contents                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/cdk8s`      | All Kubernetes manifests as TypeScript ([cdk8s](https://cdk8s.io/)) — see its [README](src/cdk8s/README.md)          |
| `src/talos`      | Talos machine config patches per node plus static pods — see its [README](src/talos/README.md)                       |
| `src/tofu`       | OpenTofu stacks, most synthesized from [`../homelab-cdktn`](../homelab-cdktn) — see its [README](src/tofu/README.md) |
| `src/helm-types` | Generator for type-safe Helm chart value interfaces                                                                  |
| `mac-ci`         | Bootstrap for the macOS Woodpecker agent (native lanes currently paused) — see its [README](mac-ci/README.md)        |
| `images`         | Custom Docker images (caddy-s3proxy, obsidian-headless, redlib)                                                      |
| `scripts`        | Release/automation scripts: helm push, ArgoCD reconcile, tofu stack wrapper, Velero                                  |

## Platform model

Some facts are rendered twice: a public hostname is a `TunnelBinding` in
`src/cdk8s` and a Cloudflare CNAME in `src/tofu`, and a static site is a Caddy
host and a SeaweedFS bucket. [`src/platform-model.json`](src/platform-model.json)
declares each of those facts once, and
[`src/platform-model.ts`](src/platform-model.ts) validates it and derives the
rest from the registries that already own it (`domain-registry.json`, the
`google` and `anthropic-federation` desired state).

| Definition         | Kubernetes rendering                 | OpenTofu rendering                           |
| ------------------ | ------------------------------------ | -------------------------------------------- |
| `PublicHostname`   | `TunnelBinding` to a Service         | proxied CNAME to the tunnel                  |
| `StaticSite`       | Caddy host serving a bucket          | SeaweedFS bucket, expiry and zone cache rule |
| `TailnetService`   | Tailscale ingress, Service or device | tag owners in the tailnet policy             |
| `ScopedCredential` | `OnePasswordItem` naming the title   | the `onepassword_item` that writes it        |
| `BucketConsumer`   | bucket name in a workload's env      | the SeaweedFS bucket                         |

cdk8s renders from the model. Its constructs take a model entry instead of a
string, looked up with `publicHostname`, `publicHostnameOfService`,
`staticSite`, `tailnetService` or `consumedBucket`; an id the model does not
declare throws at synthesis. See
[Rendering from the platform model](src/cdk8s/README.md#rendering-from-the-platform-model).

On the OpenTofu side, the `cloudflare` stack renders its tunnel CNAMEs and
static-asset cache rules from the model
([`platform.ts`](../homelab-cdktn/src/stacks/cloudflare/platform.ts)), the
`seaweedfs` stack its static-site and consumer buckets and their expiring
prefixes (`declaredBuckets`, `immutablePrefixesByBucket`), and the `tailscale`
stack the policy's tag owners (`tailnetTagOwners`). A stack also declares what
the model does not, and the stacks that write 1Password items do not read it.
[`src/cdk8s/src/platform-model`](src/cdk8s/src/platform-model) therefore holds
every definition against both renderings: it reads the synthesized manifests
and the OpenTofu stacks, and fails on a fact that is declared but not rendered,
or rendered but not declared. Today's disagreements are listed in its
`debt-allowlists.ts`, which may only shrink. To add a hostname, site, tailnet
service or credential, declare it in `platform-model.json` and render it on
both sides; after a model change, run
`bun run --cwd packages/homelab-cdktn synth` and commit each regenerated
`src/tofu/<stack>/main.tf.json`.

## Details

I've spent a _lot_ of time making this project pleasant to work with. Here are
some things I'm proud of:

- Close to zero host setup — a few commands deploy the entire cluster
- Entirely written in TypeScript built with [cdk8s](https://cdk8s.io/) and
  [Bun](https://bun.sh/)
- Automated backups to Backblaze: Velero's 6-hourly, daily, weekly and
  monthly schedules back up PVCs by an explicit per-volume policy, and
  `filer.backup` copies SeaweedFS objects as they change
- HTTPS ingress with [Tailscale](https://tailscale.com/)
- All secrets managed with [1Password](https://1password.com/)
- Declarative GitOps deployment via ArgoCD, selected and verified by Delivery
- Automated dependency updates for Docker images (with pinned SHAs), Helm
  charts, and Bun dependencies —
  [my approach](src/cdk8s/src/versions.ts) keeps every dependency pinned and
  regularly updated
- Static typing for
  [Kubernetes resources including CRDs](src/cdk8s/scripts/update-imports.ts)
  and [Helm chart parameters](src/helm-types)

## Deployment

The custom Caddy image has no file capabilities, so non-root auth gateways can
run with all container capabilities dropped. Static sites listen on port 8080
behind the existing port-80 Service and also drop all capabilities. Image smoke
checks verify the binary has no file capabilities and runs as a non-root user.

Static-site releases prune retired hostname bindings and probes through the
release's chart allowlist. TunnelBindings disable DNS updates; OpenTofu owns DNS
records, and the static-site chart does not own the content buckets.

Prometheus remains distroless and listens on loopback. Its startup, readiness,
and liveness checks use HTTP through the same-pod gateway to reach the backend
health endpoints with the operator's original probe timing limits.
ArgoCD waits for `NoPodReady` and `SomePodsNotReady` rollout conditions within
the existing sync timeout. Prometheus health requires current-generation
`Available` and `Reconciled` conditions; failed reconciliation still fails the
sync. ArgoCD's configuration reconciles before the monitoring application wave.
Embedded gateway ports declare TCP explicitly so the API's default does not
leave the Prometheus and Alertmanager custom resources perpetually OutOfSync.

Flipt's upstream also listens only on loopback, at port 8081. Both containers'
HTTP health probes use the gateway's Pod-addressable port 8080, which forwards
`/health` to that private upstream. Kubelet cannot reach a loopback listener
through the Pod IP; probe timing limits and the management authentication
boundary remain unchanged.

Temporal's external gRPC Service keeps port 7233 and forwards to its authenticated
gateway on port 17233. The gateway shares the server's Pod network, so its
listener must avoid Temporal's frontend, history, matching, worker, membership,
and HTTP ports. The synthesized chart tests check that separation and the
gateway's Service, network policy, and probe wiring.

Built chart tests validate repo-declared container port names against the API
server's 15-character and syntax limits. This includes sidecars in external
Helm values and operator overrides, whose port names are not checked by their
parent Application or custom-resource schemas.

Storm Forum's active storage claims share a sync wave with their first consumer:
the database Deployment at -1 and the release Job at 0. The ZFS storage class
uses `WaitForFirstConsumer`, so an earlier PVC wave would block provisioning
before ArgoCD could create the required Pod. The web Deployment remains at wave
1, after the database is healthy and the release Job has completed.

Woodpecker verifies source and publishes immutable artifacts. Delivery owns
operational plans, applies and releases through Temporal. The
[CI pipeline guide](../docs/wiki/src/content/docs/explanation/ci-pipeline-shape.md)
explains CI change selection:

- **Every PR** runs the change-selected `bun run verify` graph (which includes homelab's
  `check:talos`, `lint:helm`, and `check:1password` tasks), offline OpenTofu
  validation and immutable artifact rehearsals.
- **On merge to main**, CI builds and publishes immutable images, versioned
  Helm charts (`scripts/helm/helm-push.ts`) and archives with original
  provenance. Delivery qualifies them before executing a frozen release.

Delivery's private browser endpoint uses the existing Tailscale Kubernetes
operator and an Ingress tagged `tag:delivery`. Its policy allows admins only.
No application-side Tailscale credential or additional OAuth client is required.

Never apply manifests directly with `kubectl apply` — all changes go through
ArgoCD, which reverts direct mutations.

## NetworkPolicy enforcement tooling

Each namespace that has NetworkPolicies carries one allow-all staging policy,
`enforcement-staging-<namespace>`, rendered from
`src/cdk8s/src/fleet-policy/enforcement-stages.ts`. While its `podSelector` is
`{}` the namespace is **open**; while it selects
`homelab.sjer.red/enforcement-staging: never`, a label no pod carries, the
namespace is **enforced**. Two scripts under `scripts/network-policy/` read
that live state.

| Command                                                           | Effect                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `bun run netpol:check <namespace> [--json]`                       | Read-only gate for one namespace                                  |
| `bun run netpol:check --all-staged [--json]`                      | The gate for every staged namespace, as a table                   |
| `bun run netpol:check --coverage [--allow-unstaged <name>]...`    | Pre-switch gate: every namespace with policies and pods is staged |
| `bun run netpol:open <namespace>\|--all`                          | Dry run: the manifest and what it would change                    |
| `bun run netpol:open <namespace>\|--all --apply --reason "<why>"` | Break-glass: open the namespace(s) in the cluster                 |

`netpol:check` exits non-zero when any check fails. `--since-minutes <n>`
(default 10) sets the restart and denial window; `--expect-stage
open|enforced` fails when the live stage differs.

| Check      | Source                                                                                       | Result                                        |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `stage`    | The live staging policy's selector and rules                                                 | Reported; fails if unrecognized or unexpected |
| `pods`     | `kubectl get pods`: every pod Ready, no container restart in the window                      | Pass or fail                                  |
| `services` | Services and EndpointSlices: every Service backed by pods has a ready endpoint               | Pass or fail                                  |
| `urls`     | Hosts from `platform-model.json`; path and accepted statuses from the live blackbox `Probe`s | Pass, fail or not checked                     |
| `probes`   | `toolkit prom query probe_success` for the namespace's `Probe` jobs                          | Pass, fail or not checked                     |
| `denials`  | `kube-network-policies` container log of the `kube-flannel` pods                             | A note; never gates                           |

`--coverage` reads only policies and pods. It lists every namespace that has a
NetworkPolicy other than its own staging policy, with its policy count, pod
count and stage, and fails while any of them has pods but no staging policy
(or an unrecognized one). A namespace without pods is reported as `no pods`
and passes. `--allow-unstaged` excuses a namespace by name, or by prefix when
the entry ends in `-` or `*`; it is repeatable.

"Not checked" is never a pass: it marks a tailnet host that is not HTTP, or a
Prometheus that could not be queried. URL requests run from the operator's
machine and do not follow redirects; a redirect from a service whose probe
follows redirects counts as an answer.

`netpol:open --apply` is the one sanctioned direct `kubectl apply` in this
package. It writes only `enforcement-staging-<namespace>` (server-side apply,
field manager `network-policy-break-glass`), refuses to run without
`--reason`, deletes nothing, and prints the stage-map entries that must be set
to `"open"` in source. ArgoCD reverts the live change at the owning
Application's next sync, so the source change has to follow.

## Manifest validation

CDK8s `dist/` contains native Kubernetes manifests for kubeconform validation.
Helm publication stages retained-worker expansion separately, fingerprints the
generated template bytes, and validates them through real Helm rendering.
The synth child receives the producer's exact chart-revision inventory through
its explicit environment so packaged child Applications retain their planned versions.
The local Helm render and lint commands use that same expansion. Keep
PostgreSQL-selected worker pools and images in release parameters rather than
writing them into native synth output or chart defaults.

Chart staging keeps real Helm lint, template validation and packaging. Successful
validation renders are captured privately and discarded; lint and package progress
remain visible. Failure output is retained in a separate private temporary
directory named by the error, with stdout capped at 16 MiB and diagnostics at
64 KiB. These files stay outside chart archives and release staging cleanup.

## Installation

### Talos

The version catalog pins the Talos and Kubernetes releases. The source validator
merges every public Torvalds patch into a complete synthetic configuration and
runs the native Talos validator. Generated fixture credentials stay in memory;
only the validation summary is printed.

```bash
bun run --cwd packages/homelab talos:config validate-source
```

Talos 1.14 patches use native configuration documents for the installer,
resolver, node taints, kubelet, API server, and proxy. Keep their semantic settings
in source; do not reintroduce conflicting legacy fields into generated documents.
See [Talos contributor reference](src/talos/README.md) for the tooling API.

For promotion sandbox prerequisites on an existing node, use
[Install promotion sandbox prerequisites](../docs/wiki/src/content/docs/how-to/install-promotion-sandbox-prerequisites.md).
Its operator command retains live credentials and unrelated settings in memory,
checks the allowed policy delta, and validates the full configuration before an
explicit apply. Source generation is a validation tool, not a replacement for
an existing node's identities and configuration.

Use [workstation credentials](../docs/wiki/src/content/docs/how-to/set-up-workstation-credentials.md)
for authenticated `toolkit talosctl` access. Keep the internal control-plane
endpoint stable; external clients use the configured Tailscale management endpoint.

### Kubernetes

1. Install `helm`:

```bash
brew install helm
```

2. Install Argo CD manually (it is imported into Argo CD itself as part of the
   cdk8s manifest):

```bash
kubectl create namespace argocd
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd --namespace argocd
```

3. Set the 1Password credentials in `src/cdk8s/secrets/` — copy the
   `*.example` files (`1password-secret.yaml.example`,
   `1password-token.yaml.example`) and fill them in. Never commit the filled
   files. These are the only manually-set credentials; everything else syncs
   from 1Password. The credential in `1password-secret.yaml` must be base64
   encoded:

```bash
cat 1password-credentials.json | base64 -w 0
```

```bash
kubectl create namespace 1password
kubectl apply -f src/cdk8s/secrets/1password-secret.yaml
kubectl apply -f src/cdk8s/secrets/1password-token.yaml
```

4. Build the manifests from `src/cdk8s` (`bun run build`); ArgoCD deploys them
   from the pushed Helm chart from then on.

5. Get the initial Argo CD `admin` password, then change it:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
```

### ZFS

Adapted from <https://www.roosmaa.net/blog/2024/setting-up-zfs-on-talos/>

1. Create a shell with the maintenance pod:

```bash
kubectl apply -f src/talos/pods/shell.yaml
```

2. Create a ZFS pool:

```bash
# for nvme storage
kubectl exec pod/shell -n maintenance -- \
  nsenter --mount=/proc/1/ns/mnt -- \
  zpool create -m legacy -f zfspv-pool-nvme \
  /dev/disk/by-id/nvme-Samsung_SSD_990_PRO_4TB_S7KGNU0X511734N

# for hdd storage
kubectl exec pod/shell -n maintenance -- \
  nsenter --mount=/proc/1/ns/mnt -- \
  zpool create -m legacy -f zfspv-pool-hdd raidz2 \
  /dev/sdb \
  /dev/sdc \
  /dev/sdd \
  /dev/sde \
  /dev/sdf \
  /dev/sdg
```

3. Storage classes on these pools (`src/cdk8s/src/misc/storage/storage-classes.ts`):

- `ZfsNvmeVolume` claims use `zfs-ssd-lz4`. Claims provisioned before lz4
  became the default stay on `zfs-ssd`, because a PVC's class is immutable;
  `zfs-nvme-uncompressed-claims.ts` lists them and must not grow.
- `scripts/zfs-nvme-lz4.ts` moves those older datasets to lz4 in place through
  their `ZFSVolume` resources. It is a dry run unless given `--apply`. See
  [Enable lz4 on existing NVMe volumes](../docs/wiki/src/content/docs/how-to/enable-lz4-on-nvme-volumes.md).
- If a pool drive is replaced, update its serial in `NVME_POOL_DRIVES`
  (`src/cdk8s/src/resources/monitoring/monitoring/rules/storage/nvme.ts`), which
  maps pools to drives for the write-budget and amplification recordings.

## Upgrade

### Upgrade Talos

```bash
VERSION=v1.14.2
# Upgrade the CI worker first. The short MagicDNS name is a direct worker
# endpoint; a worker cannot proxy its own Talos request. Use the Torvalds
# Tailscale FQDN for all control-plane operations.
talosctl --endpoints liskov --nodes liskov upgrade \
  --image factory.talos.dev/metal-installer-secureboot/d953d04c966642907c1061252288cdc30189c2973f083de93355faac1e9d54cb:$VERSION \
  --drain=false

# Torvalds is the single control plane and production node. Expect a brief
# control-plane interruption while it reboots.
talosctl --nodes torvalds.tailnet-1a49.ts.net upgrade \
  --image factory.talos.dev/metal-installer-secureboot/4560d31e3c529f9808e0898c2804d25be14201992fe2792abd4a09618e0d39a9:$VERSION \
  --drain=false

talosctl --endpoints liskov --nodes liskov version
talosctl --nodes torvalds.tailnet-1a49.ts.net version
```

### Upgrade Kubernetes

```bash
VERSION=1.37.1

# `upgrade-k8s` discovers liskov by raw Tailscale IP, which does not match
# its hostname-only Talos API certificate. Upgrade control-plane components,
# kube-proxy, and bootstrap manifests first, without kubelet updates. Preload
# the images explicitly because automatic pre-pull must remain disabled.
for COMPONENT in kube-apiserver kube-controller-manager kube-scheduler kube-proxy; do
  talosctl --namespace inmem --nodes torvalds.tailnet-1a49.ts.net image pull \
    registry.k8s.io/$COMPONENT:v$VERSION
  talosctl --nodes torvalds.tailnet-1a49.ts.net image pull \
    registry.k8s.io/$COMPONENT:v$VERSION
done
talosctl --endpoints liskov --nodes liskov image pull \
  registry.k8s.io/kube-proxy:v$VERSION

# Select the Kubernetes endpoint explicitly. The machine configuration also
# advertises the LAN endpoint, which is not routable from a tailnet-only client.
talosctl --endpoints torvalds.tailnet-1a49.ts.net \
  --nodes torvalds.tailnet-1a49.ts.net \
  upgrade-k8s --endpoint https://torvalds.tailnet-1a49.ts.net:6443 \
  --to $VERSION --pre-pull-images=false --upgrade-kubelet=false

# If a static-pod step remains on a config-version mismatch after 60 seconds,
# leave upgrade-k8s running and reconcile the rendered pods from another shell.
# talosctl --nodes torvalds.tailnet-1a49.ts.net service kubelet restart

# Then update each kubelet through its hostname-authenticated Talos API.
talosctl --namespace system --endpoints liskov --nodes liskov image pull \
  ghcr.io/siderolabs/kubelet:v$VERSION
talosctl --namespace system --nodes torvalds.tailnet-1a49.ts.net image pull \
  ghcr.io/siderolabs/kubelet:v$VERSION
talosctl --endpoints liskov --nodes liskov patch machineconfig --mode no-reboot \
  --patch $'machine:\n  kubelet:\n    image: ghcr.io/siderolabs/kubelet:v'"$VERSION"
talosctl --nodes torvalds.tailnet-1a49.ts.net patch machineconfig --mode no-reboot \
  --patch $'machine:\n  kubelet:\n    image: ghcr.io/siderolabs/kubelet:v'"$VERSION"

kubectl get nodes -o wide
kubectl get --raw='/readyz?verbose'
kubectl get --raw='/livez?verbose'
```
