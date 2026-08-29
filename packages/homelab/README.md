# Homelab

[![Renovate enabled](https://img.shields.io/badge/renovate-enabled-brightgreen.svg)](https://docs.renovatebot.com/)
![ArgoCD badge](https://argocd.tailnet-1a49.ts.net/api/badge?name=apps)

This package contains everything that runs my homelab. The cluster has two
Talos Linux nodes: `torvalds` (control plane, all production workloads) and
`liskov` (CI-only worker). Services are deployed across multiple namespaces
(media, home, postal, etc.) using an app-of-apps pattern in ArgoCD.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes, cluster
topology details, the 1Password secret linter, and operator runbooks.

## Layout

| Directory        | Contents                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/cdk8s`      | All Kubernetes manifests as TypeScript ([cdk8s](https://cdk8s.io/)) — see its [README](src/cdk8s/README.md)  |
| `src/talos`      | Talos machine config patches per node plus static pods — see its [README](src/talos/README.md)               |
| `src/tofu`       | OpenTofu stacks (Cloudflare, GitHub, Tailscale, ArgoCD, SeaweedFS, …) — see its [README](src/tofu/README.md) |
| `src/helm-types` | Generator for type-safe Helm chart value interfaces                                                          |
| `mac-ci`         | Bootstrap for a macOS Buildkite agent (currently dormant) — see its [README](mac-ci/README.md)               |
| `images`         | Custom Docker images (caddy-s3proxy, obsidian-headless, redlib)                                              |
| `scripts`        | Release/automation scripts: helm push, ArgoCD reconcile, tofu stack wrapper, Velero                          |

## Details

I've spent a _lot_ of time making this project pleasant to work with. Here are
some things I'm proud of:

- Close to zero host setup — a few commands deploy the entire cluster
- Entirely written in TypeScript built with [cdk8s](https://cdk8s.io/) and
  [Bun](https://bun.sh/)
- Automated backups
- HTTPS ingress with [Tailscale](https://tailscale.com/)
- All secrets managed with [1Password](https://1password.com/)
- Declarative GitOps deployment via ArgoCD, driven by CI (see below)
- Automated dependency updates for Docker images (with pinned SHAs), Helm
  charts, and Bun dependencies —
  [my approach](src/cdk8s/src/versions.ts) keeps every dependency pinned and
  regularly updated
- Static typing for
  [Kubernetes resources including CRDs](src/cdk8s/scripts/update-imports.ts)
  and [Helm chart parameters](src/helm-types)

## Deployment

Deploys are driven by the static Buildkite pipeline
([`.buildkite/pipeline.yml`](../../.buildkite/pipeline.yml)):

- **Every PR** runs the root `bun run verify` graph (which includes homelab's
  `check:talos`, `lint:helm`, and `check:1password` tasks) plus change-gated
  `tofu plan`s for the affected stacks and dry-run rehearsals of the helm push
  and ArgoCD reconcile.
- **On merge to main**, the pipeline applies the tofu stacks (infra, github,
  cloudflare), pushes the versioned Helm chart
  (`scripts/helm-push.ts`), and syncs + waits on ArgoCD
  (`scripts/argocd.ts`).

Never apply manifests directly with `kubectl apply` — all changes go through
ArgoCD, which reverts direct mutations.

## Installation

### Talos

1. Create `secrets.yaml`.
2. From `src/talos`, generate the machine configuration (create
   `torvalds/patches/tailscale.yaml` from `tailscale.example.yaml` first — the
   real file holds the auth key and is never committed):

```bash
talosctl gen config \
  --with-secrets secrets.yaml \
  --config-patch-control-plane @torvalds/patches/scheduling.yaml \
  --config-patch-control-plane @torvalds/patches/certsans.yaml \
  --config-patch-control-plane @torvalds/patches/etcd-metrics.yaml \
  --config-patch @torvalds/patches/image.yaml \
  --config-patch @torvalds/patches/tailscale.yaml \
  --config-patch @torvalds/patches/dns.yaml \
  --config-patch @torvalds/patches/kubelet.yaml \
  --config-patch @torvalds/patches/sysctls.yaml \
  --config-patch @torvalds/patches/watchdog.yaml \
  --config-patch @torvalds/patches/zfs.yaml \
  --config-patch @torvalds/patches/interface.yaml \
  torvalds https://192.168.1.81:6443 --force
```

`watchdog.yaml` arms the iTCO hardware watchdog — the primary auto-recovery
mechanism for the CI-freeze failure mode; see
[`src/talos/README.md`](src/talos/README.md) for what each patch does.

The generated control-plane endpoint is an internal cluster identity. Keep it
on the stable LAN address unless every control-plane component is deliberately
migrated together. It does not determine the endpoint used by external
`talosctl` or `kubectl` clients.

3. Configure the normal `talosconfig` endpoint and node with the Torvalds
   Tailscale FQDN:
   - `endpoints: ["torvalds.tailnet-1a49.ts.net"]` — only control-plane nodes
     are endpoints.
   - `nodes: ["torvalds.tailnet-1a49.ts.net"]`.

   Liskov's Talos API certificate also includes
   `liskov.tailnet-1a49.ts.net`. Add it as a normal target only after the
   tailnet policy permits the Torvalds control-plane proxy to reach Liskov on
   TCP/50000; a worker cannot be used as its own Talos proxy endpoint.

4. Move the talosconfig so commands run without the `--talosconfig` argument:

```bash
mv talosconfig ~/.talos/config
```

5. Apply the configuration:

```bash
MAINTENANCE_IP=<ip-from-the-Talos-console>
talosctl apply-config --insecure --nodes "$MAINTENANCE_IP" --file controlplane.yaml
```

To update an already-configured node:

```bash
talosctl apply-config --nodes torvalds.tailnet-1a49.ts.net --file controlplane.yaml
```

6. Bootstrap the Kubernetes cluster:

```bash
talosctl bootstrap --nodes torvalds.tailnet-1a49.ts.net
```

7. Create a Kubernetes configuration:

```bash
talosctl kubeconfig --nodes torvalds.tailnet-1a49.ts.net
```

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

## Upgrade

### Upgrade Talos

```bash
VERSION=v1.13.9
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
VERSION=1.36.4

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
