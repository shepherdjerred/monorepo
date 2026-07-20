---
id: reference-completed-2026-06-12-talos-install-disk-selector
type: reference
status: complete
board: false
---

# Fix Talos install disk selector (serial-based) on torvalds

## Context

NVMe device names (`nvme0n1`/`nvme1n1`) on `torvalds` are assigned **randomly per boot** (the `/var` device label flipped at the May 12, May 23, June 6, June 8, and ~June 10/11 reboots). The Talos machine config selected the install disk with a hardcoded path:

```yaml
machine:
  install:
    disk: /dev/nvme0n1
    wipe: true
```

On any reinstall/recovery, this had a coin-flip chance of pointing at the **ZFS pool drive** (`zfspv-pool-nvme`, backing every `zfs-ssd`/`zfs-ssd-buildcache` PVC) and, with `wipe: true`, destroying it. At execution time (2026-06-12) the path happened to be correct; two days earlier it pointed at the ZFS drive.

## Drive identity (re-verified live before the change)

| Role                                                          | Serial              |
| ------------------------------------------------------------- | ------------------- |
| Talos system disk (EFI/META/STATE/EPHEMERAL) → install target | **S7KGNU0XB15590B** |
| ZFS pool drive (must never be the install target)             | S7KGNU0X511734N     |

Both are Samsung 990 PRO 4TB, so `model` cannot disambiguate — serial is the only safe selector. Verification procedure: `talosctl get discoveredvolumes` (find the disk whose p4 partition is EPHEMERAL) → `talosctl get disks` (map device → serial).

## What shipped

1. **`packages/homelab/src/talos/patches/image.yaml`** — replaced `disk: /dev/nvme0n1` with:

   ```yaml
   diskSelector:
     serial: S7KGNU0XB15590B
   ```

   with a comment explaining the enumeration hazard. `wipe: true` retained (now safe).

2. **Live machine config** — applied via `talosctl patch machineconfig` (strategic merge; JSON6902 is unsupported for multi-document configs). The merge patch cannot delete the old `disk` key, so it was removed with a scripted `EDITOR` pass through `talosctl edit machineconfig`. Per Talos docs, `diskSelector` "always has priority over `disk`", so the brief coexistence window was safe. Applied without reboot; node stayed Ready.

## Verification performed

- `talosctl get machineconfig` shows `install.diskSelector.serial: S7KGNU0XB15590B` and no `disk:` field
- `kubectl get nodes` Ready; `talosctl health --server=false` passes
- Note: `talosctl` emits a pre-existing warning "extra kernel arguments are not supported when booting using SDBoot" — unrelated to this change (`machine.install.extraKernelArgs` was already present)

## Related decisions (same investigation, no action)

- **Do not** put ZFS on the OS drive or move the Dagger buildcache to EPHEMERAL: BK overlayfs (the dominant CI write stream, ~66% of wear) is already on the actively-cooled OS disk, and the buildcache's `lz4 + sync=disabled` dataset cuts its physical writes 2–3×. Technically possible via `VolumeConfig` EPHEMERAL `maxSize` + `RawVolumeConfig` (requires wiping EPHEMERAL); rejected.
- Full investigation log: `packages/docs/logs/2026-05-24_torvalds-thermal-investigation.md` (Session Log 2026-06-12).
