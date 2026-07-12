# qbittorrent CrashLoopBackOff — startup probe too aggressive

## Status

Partially Complete

## What happened

User asked to look at the qbittorrent pod (`media/media-qbittorrent-*`). Found it
in `CrashLoopBackOff` (2/3 ready, exit 137 repeatedly) following a reboot of the
`torvalds` node earlier today (~17:33 PDT).

## Investigation

- `gluetun` and `qbittorrent-exporter` sidecars were healthy; only the
  `qbittorrent` container was failing.
- `kubectl describe` showed `Killing ... Container qbittorrent failed startup
probe, will be restarted` and a default TCP startup probe
  (`delay=0s timeout=1s period=10s failureThreshold=3`, i.e. a 30s window).
- `kubectl exec ... ps aux` during a live attempt showed `qbittorrent-nox`
  running at 90%+ CPU with port 8080 still refusing connections — it was still
  loading/rechecking torrent resume data on the freshly-mounted PVC, and never
  got there within 30s before kubelet SIGKILLed it.
- Ruled out ZFS/CSI as the root cause: the `FailedMount`
  (`zfs.csi.openebs.io not found`) events in the pod's history were transient
  node-reboot noise — `openebs-zfs-localpv-node` and the pool came back cleanly,
  confirmed via `talosctl dmesg` (ZFS module loaded fine, no hung-task/zpool
  errors) and the init container completing successfully.

## Fix

`packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts` had no
explicit `startupProbe`, so it fell back to cdk8s-plus's 30s default. Added an
explicit `Probe.fromTcpSocket` with `periodSeconds: 10, failureThreshold: 30`
(5-minute runway), matching the existing pattern for jellyfin/scrypted/
eufy-security-ws. Verified in a worktree:

- `bun run typecheck` and `bun run test` (homelab, cdk8s + helm-types) pass
- Rendered `dist/media.k8s.yaml` confirmed the new `startupProbe` block
- Pre-commit hooks (lint, 1Password snapshot, helm lint, quality ratchet) all
  passed

PR: https://github.com/shepherdjerred/monorepo/pull/1441 (branch
`fix/qbittorrent-startup-probe`, worktree
`.claude/worktrees/qbittorrent-startup-probe`).

## Session Log — 2026-07-10

### Done

- Diagnosed qbittorrent `CrashLoopBackOff` root cause (startup probe too tight
  for cold-start resume-data loading, not ZFS/CSI).
- Implemented and tested the startup probe fix in
  `packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts`.
- Opened PR #1441.

### Remaining

- PR #1441 needs review/merge; ArgoCD will then sync and the pod should
  recover on its next restart. Confirm post-merge that the pod reaches
  `3/3 Running` cleanly on a cold start.
- At the time of writing, the live prod pod (`media-qbittorrent-7fcf4d7b59-4wfnw`)
  is still crash-looping (6 restarts) since the fix isn't deployed yet — this is
  expected and will self-resolve once the PR merges and ArgoCD syncs (or once
  qbittorrent-nox eventually wins the race against the probe on its own).

### Caveats

- Did not merge or force a manual pod restart — left it to the normal
  ArgoCD/PR flow per repo convention (no direct `kubectl apply`/mutation on the
  single-node prod cluster).
