# K8s pod triage: eufy_security patch-YAML corruption bug + qBittorrent config-drift guard

## Status

Partially Complete (qBittorrent fully resolved; eufy_security fix awaiting PR merge)

## Context

User asked to check in on failing k8s pods. Two were crash-looping:

- `home/home-homeassistant-*` — `Init:CrashLoopBackOff` on the `install-eufy-security` init container.
- `media/media-qbittorrent-*` — `Init:CrashLoopBackOff` on the `qbittorrent-config-seed` init container.

## eufy_security patch corruption — root-caused and fixed

`install-eufy-security` failed with `patch: **** malformed patch at line 6: \`.

Investigation:

- Reproduced the exact install script (curl + tar + patch) locally in Docker against the pinned `alpine@sha256:28bd...` digest, on both arm64 and amd64 (`--platform linux/amd64`) — succeeded cleanly both times. Architecture was not the cause.
- Pulled the _actual_ deployed init container's `args` via `kubectl get pod -o json` and diffed it against a fresh `bun gen-script-tmp.ts` synth of the same spec from HEAD — found several lines that should have been a lone blank context line (`" "`, one space) had instead become a literal `\` in the live cluster manifest.
- Confirmed this is a genuine bug in the `yaml` npm package cdk8s uses to serialize manifests, not a downstream/cross-implementation quirk: parsing `dist/home.k8s.yaml` back with **the same `yaml` library that wrote it** (and separately with PyYAML) reproduces the identical corruption — a whitespace-only line inside a long double-quoted scalar's YAML line-folding escape gets mis-round-tripped into a literal backslash.
- Fix: `packages/homelab/src/cdk8s/src/resources/home/ha-custom-components.ts` now base64-encodes each patch's content and decodes it with `base64 -d` at runtime instead of inlining it as a raw heredoc. Base64 has no embedded newlines or special YAML characters, so it can't trip this escaping bug regardless of which YAML parser (cdk8s, Helm, ArgoCD, kubectl) touches the manifest downstream.
- Verified the fix byte-exact: decoded the new base64 payload from a fresh build and diffed against both source `.patch` files — identical.
- `bun run test` (256 tests), `bun run typecheck`, and the full `homelab-typecheck` pre-commit hook (helm-template render, argocd-helm-render, 1Password lint, quality ratchet) all pass.
- Opened PR #1460: https://github.com/shepherdjerred/monorepo/pull/1460, branch `fix/eufy-patch-yaml-corruption` in `.claude/worktrees/fix-eufy-patch-yaml`.

Not yet done: merge + confirm the pod goes Running post-ArgoCD-sync (listed as a checkbox in the PR's test plan).

## qBittorrent config drift — diagnosed, needs an operator decision

`qbittorrent-config-seed` fails its drift guard (`check-config-drift.sh`) with:

```
- [AutoRun] OnTorrentAdded\Program : declared=</bin/bash /scripts/hitandrun-share-limit.sh "%I"> live=<>
- [AutoRun] OnTorrentAdded\Enabled : declared=<true> live=<false>
```

This is the guard working as designed, not a bug: PR #1454 (merged today, 2026-07-11) added the `OnTorrentAdded` Hit & Run share-limit hook to the committed `qBittorrent.conf`, but the live PVC's on-disk config predates that change (the seed step only runs once, on a fresh PVC — see `packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/check-config-drift.sh`). The intended reconciliation (per the script's own error message) is to make the live config match committed, not the reverse.

Attempted to reconcile the live config directly on the PVC:

- A debug pod mounting the same `qbittorrent-pvc` (OpenEBS ZFS LocalPV, RWO) failed with `verifyMount: device already mounted` — the CSI driver refused a second mount attempt while the crash-looping pod still held it, even on the same single node.
- `kubectl debug node/torvalds` (to edit the file at its host path directly) failed: Talos is a minimal immutable OS with no shell/userland binaries on the host, so `chroot /host sh` has nothing to exec. This path is a dead end on this cluster.

### Resolved

User asked to keep going. The `media` ArgoCD Application's `syncPolicy.automated` is `{}` (no `selfHeal`), meaning it only reconciles on a new git-driven sync, not continuously — so a temporary imperative scale-down was safe from being immediately reverted:

1. `kubectl scale deployment media-qbittorrent -n media --replicas=0` — released the PVC mount (waited for the pod to fully terminate).
2. Applied a short-lived debug pod (`busybox:latest`, `sleep 300`) mounting the same `qbittorrent-pvc` at `/config` in the `media` namespace (which is `pod-security.kubernetes.io/enforce: privileged`, so no PSA violations).
3. `kubectl exec` into the debug pod: backed up `qBittorrent.conf`, then `sed`-patched the two drifted keys (`OnTorrentAdded\Enabled=false→true`, `OnTorrentAdded\Program=` → the hitandrun script path) to match the committed file exactly.
4. Verified with the _actual_ `check-config-drift.sh` (copied live conf out, ran the real script locally against the committed seed) — exit 0, in sync.
5. Deleted the debug pod, scaled the deployment back to `replicas=1`.
6. Pod came up `3/3 Running`, 0 restarts, stable for 1+ minute. ArgoCD `media` Application reports `Synced`/`Healthy`.

Cluster-wide check afterward: the only remaining non-Running pod is `home-homeassistant` (Init:CrashLoopBackOff), which is the eufy_security issue already fixed in PR #1460, pending merge.

## Session Log — 2026-07-11

### Done

- Root-caused and fixed the eufy_security patch corruption (genuine `yaml`-library round-trip bug). PR #1460 opened, all local verification green.
- Diagnosed the qBittorrent config-drift crash-loop as an expected guard firing correctly after PR #1454's same-day config change, not a new bug.

- Reconciled the qBittorrent live PVC config to match the committed `AutoRun` keys via a temporary scale-to-0 + debug-pod PVC mount; deployment is back at `replicas=1`, `3/3 Running`, ArgoCD `Synced`/`Healthy`.

### Remaining

- Merge PR #1460, confirm `home-homeassistant`'s eufy_security init container goes green post-sync. This is the only pod left in a bad state cluster-wide as of this session.

### Caveats

- The eufy_security bug is a `yaml` package (cdk8s dependency) defect, not code we own — worth a small upstream issue/report if the user wants it filed, but out of scope here.
- Any future `patches?:` content embedded via `ha-custom-components.ts`'s heredoc mechanism for _other_ HACS components could theoretically hit the same corruption if a patch has a lone-whitespace context line; the base64 fix covers all of them since it's the shared `buildInstallScript` helper, not a per-component special case.

## Workflow Friction

- `kubectl debug node/<name>` is a dead end on Talos nodes (no host shell) for any "edit a file directly on the node" troubleshooting step. Worth noting in the `packages/homelab/AGENTS.md` Talos section so future sessions don't burn time on it — deferred, not filed as a todo since it's a one-line doc note rather than a task.
