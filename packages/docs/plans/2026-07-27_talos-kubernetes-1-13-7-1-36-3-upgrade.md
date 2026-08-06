---
id: plan-2026-07-27-talos-kubernetes-1-13-7-1-36-3-upgrade
type: plan
status: in-progress
board: false
---

# Talos 1.13.7 and Kubernetes 1.36.3 Upgrade

## Summary

Upgrade both Talos nodes to 1.13.7, then upgrade the control plane to Kubernetes
1.36.3. Publish one consolidated repository record after live verification and
close Renovate PRs #1723, #1724, and #1725 as superseded.

## Execution

- Revalidate release tags, the Sidero kubelet image, both Factory installer
  images, Talos services, Kubernetes readiness, etcd, and the Buildkite queue.
- Pause Buildkite dispatch and let in-flight liskov jobs finish before its reboot.
- Upgrade liskov first, then torvalds, with the verified Factory image tags and
  `--drain=false`; verify each node before proceeding.
- Dry-run and perform `talosctl upgrade-k8s --to 1.36.3` through
  `https://torvalds:6443`, then verify the full control plane and resume CI.

## Repository Record

- Update both installer references and digests, the Talos/Kubernetes state pins,
  both README upgrade examples, the Liskov ISO example, and Temporal's CLI pins.
- Run the Talos schematic check plus affected verification, submit a Git-spice PR,
  merge only after Buildkite and review are green, then close the three bot PRs.
