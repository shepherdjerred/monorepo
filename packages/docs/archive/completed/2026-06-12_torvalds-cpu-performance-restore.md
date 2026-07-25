---
id: reference-completed-2026-06-12-torvalds-cpu-performance-restore
type: reference
status: complete
board: false
---

# Restore CPU performance on torvalds (RAPL cap → stock, drop perf-limiting kernel args)

## Context

torvalds's CPU was deliberately hobbled in May when its cooler couldn't keep up (daily 100 °C TJMax): a RAPL DaemonSet caps package power at 95/140 W (~25–35% multi-thread loss), and the Talos factory-image schematic bakes in `cpufreq.default_governor=powersave` + `intel_pstate=passive`. Since then the user installed a large AIO (heavy CI days now peak 82–84 °C) and both NVMes have dedicated cooling — the caps are no longer needed at their conservative values.

User decisions (2026-06-12): keep the DaemonSet but raise to Intel stock **125/253 W** (guards against ASUS firmware defaulting PL1 to unlimited, which caused the original 100 °C); **no** Grafana alerts in this change; **prep-only** for the kernel-arg fix — I make all repo/live-config changes and hand over the one-line `talosctl upgrade` command (node reboot) for the user to run.

Current live state (verified): governor=`schedutil` via `intel_cpufreq` (passive mode — the powersave-governor arg is NOT winning, schedutil is), turbo on, RAPL=95/140 (DaemonSet). `processor.max_cstate=2` stays — idle-latency tuning, not a perf limiter.

## Changes

### 1. Raise RAPL cap to stock — `packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts` (~line 134)

```typescript
createCpuPowerCap(chart, { pl1Watts: 125, pl2Watts: 253 });
```

Update the comment: the cap now enforces Intel stock limits as a guard against ASUS "unlimited PL1" firmware defaults (the original cause of sustained 100 °C), not as a thermal crutch — the AIO (May 26) handles dissipation. Construct: `src/cdk8s/src/resources/cpu-power-cap.ts` (no changes needed; Zod validates pl2 ≥ pl1; no tests reference it).

Deploys automatically post-merge: CI → ChartMuseum → ArgoCD `apps` Application (auto-sync).

### 2. Clean the factory schematic — `packages/homelab/src/talos/image.yaml`

Remove:

- `cpufreq.default_governor=powersave` (intended-but-inert; delete so it can never win)
- `intel_pstate=passive` (in effect today; removal restores active-mode HWP hardware P-states)

Keep `processor.max_cstate=2` and all `systemExtensions`.

### 3. Fix `update-image-id.ts` digest bug, then regenerate — `packages/homelab/src/talos/update-image-id.ts`

The script POSTs the schematic to `https://factory.talos.dev/schematics` and `replaceAll`s the old schematic ID in `patches/image.yaml` + `packages/homelab/README.md` — but **leaves the pinned `@sha256:` digest stale**. Registries resolve by digest over tag, so the new reference would silently point at the old image.

Enhance the script (Bun APIs, Zod for the factory response per repo conventions): after obtaining the new ID, fetch the new digest from the factory registry —
`HEAD https://factory.talos.dev/v2/metal-installer-secureboot/<newId>/manifests/<version>` with `Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json` → `Docker-Content-Digest` response header (parse version from the existing image line; fail fast if the header is missing) — and rewrite the `@sha256:...` portion in `patches/image.yaml` alongside the ID.

Then run: `bun run src/talos/update-image-id.ts` (from `packages/homelab`).

Cross-check the digest independently: `crane digest factory.talos.dev/metal-installer-secureboot/<newId>:v1.13.3` must equal what the script wrote.

### 4. Remove dead `machine.install.extraKernelArgs` — `packages/homelab/src/talos/patches/image.yaml`

Delete the `extraKernelArgs` block under `machine.install` (talosctl warns "extra kernel arguments are not supported when booting using SDBoot" — they're no-ops on this SecureBoot node and now contradict the cleaned schematic). Keep the `sysfs` RAPL values (125/253 — they now match the DaemonSet).

### 5. Sync live machine config (no reboot)

Using the same scripted-`EDITOR` technique as the disk-selector fix (strategic merge can't delete keys; JSON6902 unsupported on multi-doc configs):

- Remove `machine.install.extraKernelArgs` (the powersave/passive copies)
- Update `machine.install.image` to the new `<newId>:v1.13.3@sha256:<newDigest>` reference

Both inert until install/upgrade → applies without reboot. Verify with `talosctl get machineconfig v1alpha1 -o yaml`.

### 6. Handoff — user runs the upgrade

Provide the exact command (from the README runbook, with the new ID):

```bash
talosctl upgrade --nodes 100.102.88.88 \
  --image factory.talos.dev/metal-installer-secureboot/<newId>:v1.13.3 \
  --drain=false
```

~5 min reboot. Post-reboot verification (I run these when the user says it's done, or they can):

- `talosctl read /proc/cmdline` → no `cpufreq.default_governor=powersave`, no `intel_pstate=passive`; `processor.max_cstate=2` still present
- `talosctl read /sys/devices/system/cpu/cpu0/cpufreq/scaling_driver` → `intel_pstate` (active mode; note: governor will read `powersave` — that's the normal HWP-managed dynamic mode, not the passive-mode min-freq governor)
- `talosctl read /sys/class/powercap/intel-rapl:0/constraint_{0,1}_power_limit_uw` → 125000000 / 253000000 (after the cap change has merged + ArgoCD synced)
- `kubectl get pods -n node-tuning` → cpu-power-cap Running (not CrashLoop)

### 7. Docs & git

- Mirror this plan to `packages/docs/plans/2026-06-12_torvalds-cpu-performance-restore.md` (Status: In Progress until the user runs the upgrade and RAPL/cmdline verify clean)
- Append Session Log to the thermal investigation log (`packages/docs/logs/2026-05-24_torvalds-thermal-investigation.md`)
- Commit on the existing `fix/talos-install-disk-selector` branch (same Talos-hygiene domain, still unmerged) — separate commit, conventional message

## Verification (pre-handoff)

1. `cd packages/homelab && bun run typecheck && bunx eslint src/cdk8s/src/cdk8s-charts/apps.ts src/talos/update-image-id.ts --fix` (note: update-image-id.ts lives outside src/cdk8s — confirm which eslint project covers it; run the homelab package lint)
2. `bun run src/talos/update-image-id.ts` succeeds; `git diff` shows ID **and** digest changed together in `patches/image.yaml`, ID changed in `packages/homelab/README.md`
3. `crane digest` cross-check matches the digest the script wrote
4. Live config shows new image ref + no install extraKernelArgs; node still Ready
5. RAPL 125/253 + cmdline checks happen post-merge / post-reboot (step 6) — not claimable in this session

## Out of scope

- Grafana thermal alert rules (user-deferred again; still the standing follow-up in the thermal doc)
- `processor.max_cstate=2`, kubelet reservations, Kueue quota (capacity caps, intentionally kept)
- BIOS-level Vcore offset / power limits

## Session Log — 2026-06-12

### Done

- Raised RAPL cap to Intel stock 125/253 W in `packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts` (deploys post-merge via CI → ChartMuseum → ArgoCD `apps`)
- Removed `cpufreq.default_governor=powersave` + `intel_pstate=passive` from the factory schematic `packages/homelab/src/talos/image.yaml` (kept `processor.max_cstate=2`)
- Fixed the stale-digest bug in `packages/homelab/src/talos/update-image-id.ts`: it now refreshes the pinned `@sha256` digest from the factory registry alongside the schematic ID (previously a regenerated reference silently kept resolving to the old image, since digest beats tag). Added zod to `packages/homelab` deps for response validation; replaced the banned `as { id: string }` assertion.
- Regenerated: new schematic ID `cb41030567751f478585f38eb478b34adb4c262df80a6967cadbbf085974c38c`, digest `sha256:c3537137…edec8` (cross-checked with `crane digest`); written to `patches/image.yaml` + `packages/homelab/README.md`
- Synced live machine config (no reboot): new `install.image`, removed the dead `install.extraKernelArgs` (SDBoot no-ops — the talosctl warning about them is gone now)
- Verified: homelab typecheck clean, cdk8s lint clean, 247 tests pass, node Ready

### Remaining

- **Operator: run the upgrade** (reboots the node, ~5 min):
  `talosctl upgrade --nodes 100.102.88.88 --image factory.talos.dev/metal-installer-secureboot/cb41030567751f478585f38eb478b34adb4c262df80a6967cadbbf085974c38c:v1.13.3 --drain=false`
- Post-reboot verify: `/proc/cmdline` has no powersave/passive args; `scaling_driver` = `intel_pstate` (active/HWP; governor will read "powersave" — that's normal HWP mode, not min-freq)
- Post-merge verify: RAPL = 125000000/253000000 in `/sys/class/powercap/intel-rapl:0/`, `cpu-power-cap` pod Running
- Watch CPU + NVMe temps on the next heavy CI day under the restored limits (thermal alert rules still don't exist — standing follow-up)

### Caveats

- `src/talos/update-image-id.ts` has no typecheck/lint coverage (outside the cdk8s/helm-types workspaces, eslint-ignored) — it was exercised by running it for real
- The new RAPL values only deploy after this branch merges; until then the DaemonSet still enforces 95/140
