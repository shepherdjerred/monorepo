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

## Session Log — 2026-07-27

### Done

- Approved the consolidated rollout and captured the live-upgrade sequence.
- Paused the Buildkite default queue, allowed the in-flight job to finish, and
  resumed dispatch after the rollout.
- Upgraded liskov and torvalds from Talos 1.13.6 to 1.13.7 with their verified
  Factory installer tags; both nodes report Talos 1.13.7 and are Ready.
- Upgraded Kubernetes control-plane components, kube-proxy, and both kubelets
  from 1.36.2 to 1.36.3. `readyz` and `livez` pass, and `kubectl version`
  reports v1.36.3 for client and server.
- Verified both Factory installer digests with `bun run check:talos` and ran
  `bun run verify -- --affected` successfully.
- Published the consolidated repository record as [PR #1739](https://github.com/shepherdjerred/monorepo/pull/1739).

### Remaining

- Publish and merge the consolidated repository record, then close Renovate
  PRs #1723, #1724, and #1725 as superseded.

### Caveats

- torvalds is the single control-plane and prod node; its Talos reboot is a brief
  service interruption.
- `talosctl upgrade-k8s` rediscovered liskov by raw Tailscale IP, which does
  not match liskov's hostname-only Talos API certificate. The control-plane
  upgrade completed with kubelet updates disabled, then each kubelet was
  patched through its hostname-authenticated Talos API.
- The API server static-pod transition stalled once; restarting only the
  torvalds kubelet completed the turnover before the final readiness checks.
