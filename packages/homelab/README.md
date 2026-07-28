# Homelab

[![Renovate enabled](https://img.shields.io/badge/renovate-enabled-brightgreen.svg)](https://renovatebot.com/)
![ArgoCD badge](https://argocd.tailnet-1a49.ts.net/api/badge?name=apps)

This repository contains resources related to my homelab. The server is named
`torvalds` - I give each of my servers a unique name so that I can keep track of
them over time. Services are deployed across multiple namespaces (media, home,
postal, etc.) using an app-of-apps pattern in ArgoCD.

Currently my server is managed with Kubernetes. I've used Docker, Ansible, and
bash scripts in the past. Kubernetes has been an interesting experiment and I
think it's overall worthwhile since the ecosystem is so rich.

## Details

I've spent a _lot_ of time making this project pleasant to work with. Here are
some things I'm proud of:

- Close to zero host setup
  - It's just a few commands to deploy my entire cluster

- Entirely written in TypeScript built with [cdk8s](https://cdk8s.io/) and
  [Bun](https://bun.sh/)
- Automated backups
- HTTPS ingress with [Tailscale](https://tailscale.com/)
- All secrets managed with [1Password](https://1password.com/)
- Declarative deployment via ArgoCD (manifests applied manually since the CI pipeline was removed)

- Automated dependency updates
  - For Docker images (w/ pinned SHAs)
  - For Helm charts
  - For Bun dependencies
  - [My approach](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/versions.ts)
    allows all of my dependencies to be pinned and updated regularly

- Static typing for:
  - [Kubernetes resources including CRDs](src/cdk8s/scripts/update-imports.ts)
  - [Helm chart parameters](src/helm-types)

## Installation

### Talos

1. Create `secrets.yaml`
2. Create the configuration file:

```bash {"interpreter":""}
talosctl gen config \
  --with-secrets secrets.yaml \
  --config-patch-control-plane @torvalds/patches/scheduling.yaml \
  --config-patch-control-plane @torvalds/patches/certsans.yaml \
  --config-patch @torvalds/patches/image.yaml \
  --config-patch @torvalds/patches/tailscale.yaml \
  --config-patch @torvalds/patches/dns.yaml \
  --config-patch @torvalds/patches/kubelet.yaml \
  --config-patch @torvalds/patches/sysctls.yaml \
  --config-patch @torvalds/patches/zfs.yaml \
  --config-patch @torvalds/patches/interface.yaml \
  torvalds https://192.168.1.81:6443 --force

```

The generated control-plane endpoint is an internal cluster identity. Keep it
on the stable LAN address unless every control-plane component is deliberately
migrated together. It does not determine the endpoint used by external
`talosctl` or `kubectl` clients.

1. Configure the normal `talosconfig` endpoint and node with the Torvalds
   Tailscale FQDN:
   - `endpoints: ["torvalds.tailnet-1a49.ts.net"]` — only control-plane nodes
     are endpoints.
   - `nodes: ["torvalds.tailnet-1a49.ts.net"]`.

   Liskov's Talos API certificate also includes
   `liskov.tailnet-1a49.ts.net`. Add it as a normal target only after the
   tailnet policy permits the Torvalds control-plane proxy to reach Liskov on
   TCP/50000; a worker cannot be used as its own Talos proxy endpoint.

2. Move the talosconfig:

- This allows commands to be run without the `--talosconfig` argument

```bash
mv talosconfig ~/.talos/config

```

1. Apply the configuration:

```bash
MAINTENANCE_IP=<ip-from-the-Talos-console>
talosctl apply-config --insecure --nodes "$MAINTENANCE_IP" --file controlplane.yaml

```

1. If needed, update:

```bash
talosctl apply-config --nodes torvalds.tailnet-1a49.ts.net --file controlplane.yaml

```

Upgrade:

```bash
talosctl upgrade --nodes torvalds.tailnet-1a49.ts.net --image <image>
talosctl upgrade-k8s

```

1. Bootstrap the Kubernetes cluster:

```bash
talosctl bootstrap --nodes torvalds.tailnet-1a49.ts.net

```

1. Create a Kubernetes configuration:

```bash
talosctl kubeconfig --nodes torvalds.tailnet-1a49.ts.net

```

### Kubernetes

1. Install `helm`:

```bash
brew install helm

```

1. Install Argo CD manually:

> [!NOTE] This will be imported into Argo CD itself as part of the CDK8s
> manifest

```bash
kubectl create namespace argocd
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd --namespace argocd

```

1. Set the credentials in the `secrets` directory:

- Be sure not to commit any changes to these files so that secrets don't
  leak.
- These should be the only credentials that are manually set. Everything else
  can be retrieved from 1Password.
- Annoyingly, the credential in `1password-secret.yaml` _must_ be base64
  encoded.

```bash
cat 1password-credentials.json | base64 -w 0

```

```bash
kubectl create namespace 1password
kubectl apply -f secrets/1password-secret.yaml
kubectl apply -f secrets/1password-token.yaml

```

1. Build and deploy the manifests in this repo:

```bash
cd cdk8s

```

1. Get the initial Argo CD `admin` password:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

```

1. Change Argo CD the `admin` password.

### ZFS

Adapted from <https://www.roosmaa.net/blog/2024/setting-up-zfs-on-talos/>

1. Create a shell with `pods/shell.yaml`:

```bash
kubectl apply -f pods/shell.yaml

```

1. Create a ZFS pool:

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

```bash {"interpreter":"/opt/homebrew/bin/bash"}
VERSION=v1.13.7
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

```bash {"interpreter":"/opt/homebrew/bin/bash"}
VERSION=1.36.3

# `upgrade-k8s` discovers liskov by raw Tailscale IP, which does not match
# its hostname-only Talos API certificate. Upgrade control-plane components,
# kube-proxy, and bootstrap manifests first, without kubelet updates.
talosctl --endpoints torvalds.tailnet-1a49.ts.net \
  --nodes torvalds.tailnet-1a49.ts.net \
  upgrade-k8s --to $VERSION --pre-pull-images=false --upgrade-kubelet=false

# Then update each kubelet through its hostname-authenticated Talos API.
talosctl --endpoints liskov --nodes liskov patch machineconfig --mode no-reboot \
  --patch $'machine:\n  kubelet:\n    image: ghcr.io/siderolabs/kubelet:v'"$VERSION"
talosctl --nodes torvalds.tailnet-1a49.ts.net patch machineconfig --mode no-reboot \
  --patch $'machine:\n  kubelet:\n    image: ghcr.io/siderolabs/kubelet:v'"$VERSION"

kubectl get nodes -o wide
kubectl get --raw='/readyz?verbose'
kubectl get --raw='/livez?verbose'
```
