---
id: log-2026-07-25-liskov-build-talos-prep
type: log
status: in-progress
board: false
---

# liskov — hardware built, Talos install prep

Continuation of `2026-07-18_ci-capacity-options-research.md` (parts list,
purchase) and `2026-07-18_ci-node-purchase-sanity-check.md` (justification).

## Status (2026-07-25)

- All parts arrived (case landed well ahead of its Jul 31–Aug 6 estimate).
- Machine is **assembled**; BIOS **updated** by the user.
- Not yet done: RAM acceptance run, BIOS eco/fan settings verification,
  Talos install, cluster join.

## RAM acceptance (clock-sensitive — do first)

The used G.Skill 128GB kit (eBay, $1,349.97) has a **30-day return window
from delivery (~2026-07-19–21)**. Protocol from the purchase log:

1. Photograph DIMM serials.
2. memtest86 ×4 full passes at the final in-case 4-DIMM config
   (expect derated ~5200 MT/s; two 2×32 kits, not a factory quad).
3. TM5 (anta777 extreme) or Karhu for several hours at the same config.
4. **One error = return.**

Also confirm in BIOS while there: 105W eco mode for the 9950X, fan curves.
Outstanding hardware item: Sipeed NanoKVM-PCIe (was still un-ordered as of
2026-07-18 evening).

## Talos image — schematic generated

torvalds' schematic is Intel-flavored (i915, intel-ucode); liskov gets its
own. Created via the Image Factory API this session — mirrors torvalds'
kernel-lockdown args (alloy eBPF profiler compatibility), swaps in
`amd-ucode`, keeps `tailscale` + `zfs`, drops `i915` and
`processor.max_cstate=2` (NAS-responsiveness tweak, not needed on a CI box):

- Schematic ID: `d953d04c966642907c1061252288cdc30189c2973f083de93355faac1e9d54cb`
- ISO (SecureBoot): <https://factory.talos.dev/image/d953d04c966642907c1061252288cdc30189c2973f083de93355faac1e9d54cb/v1.13.6/metal-amd64-secureboot.iso>
- ISO (plain): <https://factory.talos.dev/image/d953d04c966642907c1061252288cdc30189c2973f083de93355faac1e9d54cb/v1.13.6/metal-amd64.iso>
- Both liveness-checked 200 this session. Version matches the cluster
  (v1.13.6, per `packages/homelab/src/talos/patches/image.yaml`).

**Decision (2026-07-25): SecureBoot — confirmed by user.** Install image is
`factory.talos.dev/metal-installer-secureboot/d953d04c…:v1.13.6`. Enrollment
on the ASUS PRIME B650-PLUS: Secure Boot → OS Type "Windows UEFI mode",
mode Custom, Key Management → Clear Secure Boot Keys (= setup mode), then
boot the SecureBoot ISO and confirm Talos' auto-enrollment prompt.
Microcode: `amd-ucode` extension is in the schematic (no i915/amdgpu —
NanoKVM console works via plain EFI framebuffer).

## Cluster-join sequence (when RAM passes)

1. Boot the ISO in maintenance mode; grab hardware facts:
   `talosctl -n <maintenance-ip> disks --insecure` → **990 Pro 1TB serial**
   (install disk — repo convention is diskSelector by serial, never /dev
   path; see torvalds' near-miss note in `patches/image.yaml`).
2. Author liskov machine config in `packages/homelab/src/talos/`:
   worker role, hostname `liskov`, install image
   `factory.talos.dev/metal-installer[-secureboot]/d953d04c…:v1.13.6`,
   diskSelector by serial, taint `ci=only:NoSchedule` (or
   `dedicated=ci:NoSchedule` — decide naming), tailscale patch.
3. `talosctl apply-config --insecure` with worker config → node joins.
4. 2TB 990 Pro: ZFS pool for CI caches (bun cache PVC, buildkitd PVC from
   Track 3 of `2026-07-22_ci-capacity-remediation.md`) — openebs-zfs
   storage class scoped to liskov.
5. cdk8s changes: Buildkite agent-stack nodeSelector+toleration → liskov;
   Kueue quota raise (freed from torvalds' 7.5CPU/16Gi scar tissue);
   consider registry pull-through cache for ci-base.
6. Docs to update after join: homelab AGENTS.md "Single-Node Cluster"
   section becomes wrong; update it and the buildkite-helper skill.

## Session Log — 2026-07-25

### Done

- Confirmed prior plans/status for the CI node purchase (Q&A over the
  2026-07-18 research + sanity-check logs and the 2026-07-22 remediation
  plans).
- Generated + liveness-verified the liskov Image Factory schematic and ISO
  URLs (above).
- Wrote this handoff log (left uncommitted by design — session logs don't
  go straight to main).

### Remaining

- User: RAM burn-in (memtest86 ×4 + TM5/Karhu) inside the eBay return
  window; verify eco mode + fan curves; order/install NanoKVM-PCIe.
- Agent (next session): machine config + cdk8s/Kueue/Buildkite changes per
  the sequence above, once the node boots and disk serials are known.

### Caveats

- The 2026-07-22 remediation impl plan (`status: in-progress`) tracks the
  torvalds-side Kueue/persistence work separately; liskov changes should
  compose with it, not race it.

## Session Log — 2026-07-25 (continued: build done, join PR authored)

### Done

- Hardware assembled + BIOS updated (user). SecureBoot decision recorded.
- Full port/adapt/skip audit of everything per-node on torvalds → plan doc
  `packages/docs/plans/2026-07-25_liskov-cluster-join.md`.
- **Draft PR #1629** (branch `feature/liskov-join`, worktree
  `.claude/worktrees/liskov-join`): liskov Talos config, taint, tolerations
  for all observability + CSI DaemonSets, Buildkite pinning, AMD k10temp
  alerts, `update-image-id.ts` multi-node, AGENTS.md topology update.
  `bun run verify -- --affected` green. **Draft until join day** — the
  nodeSelector strands CI if merged before the node is Ready.

### Remaining

- User: RAM burn-in (memtest86 ×4 + TM5) inside the eBay return window;
  NanoKVM; boot the SecureBoot ISO.
- Join day: runbook at `packages/homelab/src/talos/liskov/README.md`
  (serial → config → apply → pool → merge #1629 → recreate git-mirrors PVC).
- Post-soak: torvalds relaxation + Kueue raise PR (plan Phase 3).

### Caveats

- `sp5100_tco` watchdog is NOT live-verified on the B650 board — the patch
  file mandates verification before arming (`nowayout=1` + unpetted =
  boot loop).
- The liskov `diskSelector.serial` is a placeholder; an unmatched selector
  fails safe (cannot wipe the wrong disk).

## Session Log — 2026-07-25 (PR #1629 babysit: crypto-mining security review)

### Done

- Addressed Greptile P1 security thread `PRRT_kwDOHf4r4c6Tx_Db` ("CI miner
  bypasses detection"). The prior fix excluded liskov from the only
  `PotentialCryptoMining` rule via `node!="liskov"` on both operands, which
  removed the CI execution node from crypto-mining detection entirely.
- Fix (commit 310a2fcc): added `PotentialCryptoMiningCiNode` to
  `resource-monitoring.ts` — same CPU + egress thresholds scoped to
  `node="liskov"`, gated on `absent(kube_pod_status_phase{namespace="buildkite",
pod=~<job-pod-pattern>, phase="Running"} == 1)`. Every Buildkite step pod is
  pinned to liskov, so "no job running" = CI node should be idle; sustained
  mining-like load for 30m in that window pages critical. Distinguishes
  legitimate CI from an attacker instead of blanket-excluding the node.
- Added two tests in `resource-monitoring.test.ts` locking (a) the generic
  rule keeps `node!="liskov"` and (b) the CI-node rule is liskov-scoped and
  idle-gated. Typecheck + eslint + tests green; replied to and resolved the
  Greptile thread.

### Remaining

- Orchestrator pushes the commit; re-run of `robot-face-greptile-review-gate`
  should pass now that the only P1 thread is resolved. (Unchanged: join-day
  runbook + merge gate still block actual merge.)

### Caveats

- The idle-gate assumes all Buildkite job pods run on liskov (true today via
  nodeSelector). A miner running _concurrently_ with a real build is not
  caught by this rule; it targets the sustained-idle attack the reviewer
  flagged. If CI ever runs off-liskov, revisit the gate.

## Session Log — 2026-07-25 (liskov install day)

### Done

- User burned the SecureBoot Talos v1.13.6 ISO to the installer USB and booted
  liskov into Talos maintenance mode at `192.168.1.3`.
- Verified the exact disks through the maintenance API: the install target is
  the 1 TB Samsung 990 Pro, serial `S7LANL0L414099Z`; the separate 2 TB Samsung
  990 Pro, serial `S7L9NJ0L312632A`, remains reserved for `zfspv-pool-nvme`.
- Replaced the liskov installer `diskSelector.serial` placeholder with the
  verified 1 TB serial. `bun run check:talos` in `packages/homelab` confirms
  the pinned liskov v1.13.6 SecureBoot installer still matches the schematic.
- Read the live control-plane configuration without persisting it: cluster
  name `tailscale`, API endpoint `https://192.168.1.81:6443`.

### Remaining

- Provide the existing cluster `secrets.yaml` securely in this worktree so the
  worker configuration can be generated; it must be the original bundle, not
  regenerated.
- Create the gitignored per-node Tailscale patch, generate and apply the worker
  configuration, then verify Ready, Secure Boot, and the `ci=only:NoSchedule`
  taint.
- Create `zfspv-pool-nvme` only on the verified 2 TB disk; do not merge PR
  #1629 until both the node and pool are ready.

### Caveats

- `patches/watchdog.yaml` remains deliberately excluded pending its live
  hardware-module verification.
- The installer will wipe only the 1 TB disk selected by serial; the 2 TB cache
  disk must not be touched during installation.

## Session Log — 2026-07-25 (liskov installed)

### Done

- Recovered the cluster secrets bundle from the live torvalds control-plane
  configuration and used a single-use, tagged Tailscale bootstrap key in an
  ignored local patch.
- Applied liskov's worker configuration to `192.168.1.3` after confirming the
  1 TB Samsung 990 Pro serial `S7LANL0L414099Z` immediately before the write.
- Corrected the Talos v1.13 hostname patch: a legacy
  `machine.network.hostname` conflicts with the generated `HostnameConfig`;
  liskov now uses `HostnameConfig { hostname: liskov, auto: off }`.
- Verified liskov is a Kubernetes `Ready` worker with internal IP
  `192.168.1.3` and its intended `ci=only:NoSchedule` taint. KubePrism
  recovered after the control-plane restart and has healthy upstream
  connections to torvalds.

### Remaining

- Agent: create `zfspv-pool-nvme` only on the verified 2 TB Samsung 990 Pro
  (`S7L9NJ0L312632A`). Do not merge PR #1629 until both are complete.

### Caveats

- The user explicitly accepted liskov operating without firmware Secure Boot
  after the firmware reported a Secure Boot violation. The installed image still
  boots as a UKI with kernel module signature enforcement; `secureBoot: false`
  remains a deliberate security waiver for this node.
- The 2 TB cache disk has not been modified.

## Session Log — 2026-07-25 (post-join networking)

### Done

- Replaced the rejected Tailscale bootstrap credential with a new single-use,
  preauthorized `tag:k8s` auth key generated through the stored OAuth client.
  Liskov is now enrolled as `liskov.tailnet-1a49.ts.net`; the OpenEBS ZFS node
  plugin recovered to `2/2 Running`.

### Remaining

- Obtain explicit approval for the smallest Tailscale ACL change that lets the
  liskov Kubernetes node reach torvalds' API endpoint on TCP 6443. The API
  Service currently resolves to torvalds' Tailscale address, so this is a
  required worker control-plane path.
- After the policy is live and the plugin remains healthy, create
  `zfspv-pool-nvme` only on `S7L9NJ0L312632A`. Do not merge PR #1629 first.

### Caveats

- The declared ACL deliberately permits `tag:k8s` to `tag:k8s:443` but denies
  raw API port 6443. Liskov is correctly rejected on that path today; the 2 TB
  cache disk remains untouched.

## Session Log — 2026-07-25 (worker storage and isolation ready)

### Done

- Applied and server-validated the Tailscale ACL additions required by a second
  `tag:k8s` worker: TCP 6443 to the control-plane API Service endpoint and TCP
  10250 for API-server-to-kubelet exec/log/port-forward streams. Verified the
  repaired exec path with the OpenEBS liskov pod.
- Created `zfspv-pool-nvme` only on the 2 TB Samsung 990 Pro serial
  `S7L9NJ0L312632A`. Verified it is `ONLINE` (1.81 TiB), `ashift=12`,
  `autotrim=on`, and uses `atime=off`, `compression=off`, and `mountpoint=none`.
- Added the temporary live OpenEBS toleration, then tainted liskov
  `ci=only:NoSchedule`; liskov remains Ready and its OpenEBS node plugin is
  healthy.
- Corrected the runbook: worker identities cannot set their own node taints
  under the default Kubernetes NodeRestriction admission policy, and current
  OpenEBS uses the Talos host `zpool` binary through `chroot /host`.
- Published the supporting source changes on PR #1629 as
  `3d9da5141 fix(homelab): finalize liskov join prerequisites`.

### Remaining

- User decision: merge PR #1629 to move Buildkite onto liskov and replace the
  temporary OpenEBS toleration with its declarative ArgoCD-managed version.
- After the merge, perform the runbook's cache/PVC cutover and first-build
  verification; do not remove the live OpenEBS toleration before then.

### Caveats

- Firmware Secure Boot remains deliberately waived for liskov. Talos reports
  `secureBoot: false`, while the UKI image and module-signature enforcement are
  still active.
- `zfspv-pool-nvme` is a single-disk cache pool: loss requires rebuilding CI
  caches, not recovering source-of-truth data.
- The full affected verification is clean for tracked source checks, but this
  working tree's ignored generated `secrets.yaml` and `worker.yaml` trigger
  repository-wide gitleaks/prettier scans. CI evaluates a clean checkout and
  remains the merge gate for the published PR.
