---
name: ZFS HDD to SSD Migration
overview: Replace 6 HDDs with SSDs in your RAIDZ2 pool one drive at a time, starting with the 3 oldest same-batch drives, using ZFS replace and resilver.
todos:
  - id: pre-backup
    content: Create pre-migration Velero backup and verify it completed
    status: pending
  - id: replace-sda
    content: Replace sda (ZFN1KB1Z) - first same-batch 7yr drive
    status: pending
  - id: replace-sdb
    content: Replace sdb (ZFN1KA96) - second same-batch 7yr drive
    status: pending
  - id: replace-sde
    content: Replace sde (ZFN1KHXV) - third same-batch 7yr drive
    status: pending
  - id: replace-sdc
    content: Replace sdc (Z301CYXT) when remaining SSDs arrive
    status: pending
  - id: replace-sdd
    content: Replace sdd (ZTT490Z3) when remaining SSDs arrive
    status: pending
  - id: replace-sdf
    content: Replace sdf (ZW636A7C) when remaining SSDs arrive
    status: pending
  - id: final-scrub
    content: Run final scrub after all drives replaced
    status: pending
---

# ZFS RAIDZ2 HDD to SSD Migration Plan

## Overview

Replace drives in `zfspv-pool-hdd` one at a time using `zpool replace`. Each replacement triggers a
resilver that rebuilds data onto the new SSD. With SSDs, resilver should take approximately 30-60
minutes per drive.

---

## Pre-Migration State Snapshot (2025-12-07)

### ZFS Pool Status

```text
Pool:           zfspv-pool-hdd
State:          ONLINE
Type:           RAIDZ2 (6 drives, 2 parity)
Total Size:     21.8 TB raw
Allocated:      8.70 TB (39%)
Free:           13.1 TB
Fragmentation:  16%
Last Resilver:  Mon Sep 8 03:12:02 2025 (69.4G in 00:41:10)
Errors:         None
```

### Current Drive Inventory

| Device | Model              | Serial   | Size   | Hours  | Age     | Port  |
| ------ | ------------------ | -------- | ------ | ------ | ------- | ----- |
| sda    | ST4000DM004-2CV104 | ZFN1KB1Z | 4.0 TB | 61,843 | ~7.1 yr | ata-3 |
| sdb    | ST4000DM004-2CV104 | ZFN1KA96 | 4.0 TB | 61,857 | ~7.1 yr | ata-4 |
| sdc    | ST4000DM000-1F2168 | Z301CYXT | 4.0 TB | 34,139 | ~3.9 yr | ata-5 |
| sdd    | ST4000DM004-2CV104 | ZTT490Z3 | 4.0 TB | 31,948 | ~3.6 yr | ata-6 |
| sde    | ST4000DM004-2CV104 | ZFN1KHXV | 4.0 TB | 61,857 | ~7.1 yr | ata-7 |
| sdf    | ST4000DM004-2U9104 | ZW636A7C | 4.0 TB | 4,803  | ~0.5 yr | ata-8 |

WWNs: sda=naa.5000c500b2604c40, sdb=naa.5000c500b26008ec, sdc=naa.5000c5006621fea6,
sdd=naa.5000c500e3e51403, sde=naa.5000c500b260ab60, sdf=naa.5000c500ea3894dd

### Drive Batch Analysis (Same-Batch = Correlated Failure Risk)

| Batch          | Drives        | Serial Prefix | Age    | Risk Level           |
| -------------- | ------------- | ------------- | ------ | -------------------- |
| A (SAME BATCH) | sda, sdb, sde | ZFN1          | 7.1 yr | HIGH - Replace first |
| B              | sdc           | Z301          | 3.9 yr | Medium               |
| C              | sdd           | ZTT4          | 3.6 yr | Low                  |
| D              | sdf           | ZW63          | 0.5 yr | Low                  |

### Device Path Mapping (by-id paths for reference)

```text
sda -> /dev/disk/by-id/ata-ST4000DM004-2CV104_ZFN1KB1Z
sdb -> /dev/disk/by-id/ata-ST4000DM004-2CV104_ZFN1KA96
sdc -> /dev/disk/by-id/ata-ST4000DM000-1F2168_Z301CYXT
sdd -> /dev/disk/by-id/ata-ST4000DM004-2CV104_ZTT490Z3
sde -> /dev/disk/by-id/ata-ST4000DM004-2CV104_ZFN1KHXV
sdf -> /dev/disk/by-id/ata-ST4000DM004-2U9104_ZW636A7C
```

### SATA Port to Device Mapping

```text
ata-3 (pci-0000:00:17.0-ata-3) -> sda
ata-4 (pci-0000:00:17.0-ata-4) -> sdb
ata-5 (pci-0000:00:17.0-ata-5) -> sdc
ata-6 (pci-0000:00:17.0-ata-6) -> sdd
ata-7 (pci-0000:00:17.0-ata-7) -> sde
ata-8 (pci-0000:00:17.0-ata-8) -> sdf
```

### Data on HDD Pool (PVCs)

| PVC Name            | Namespace   | Capacity | Used    | Purpose           |
| ------------------- | ----------- | -------- | ------- | ----------------- |
| plex-movies-hdd-pvc | torvalds    | 4 Ti     | 2.28 TB | Plex movies       |
| plex-tv-hdd-pvc     | torvalds    | 4 Ti     | 2.90 TB | Plex TV shows     |
| qbittorrent-hdd-pvc | torvalds    | 1 Ti     | 264 GB  | Torrent downloads |
| gickup-backup-pvc   | torvalds    | 256 Gi   | 58.9 GB | Git backups       |
| chartmuseum         | chartmuseum | 8 Gi     | 26.6 MB | Helm charts       |

Total Data on HDD Pool: ~5.79 TB used of 8.62 TB available (after RAIDZ2 parity)

### NVMe Drives (Not being replaced)

| Device  | Model                   | Serial          | Size   | Power-On Hours | Purpose         |
| ------- | ----------------------- | --------------- | ------ | -------------- | --------------- |
| nvme0n1 | Samsung SSD 990 PRO 4TB | S7KGNU0XB15590B | 4.0 TB | 5,118 hrs      | Talos OS        |
| nvme1n1 | Samsung SSD 990 PRO 4TB | S7KGNU0X511734N | 4.0 TB | 10,418 hrs     | zfspv-pool-nvme |

### New SSDs (To Be Installed)

| SSD # | Serial             | Target Slot | Replacing      |
| ----- | ------------------ | ----------- | -------------- |
| 1     | (note serial here) | ata-3       | sda (ZFN1KB1Z) |
| 2     | (note serial here) | ata-4       | sdb (ZFN1KA96) |
| 3     | (note serial here) | ata-7       | sde (ZFN1KHXV) |
| 4     | (pending arrival)  | ata-5       | sdc (Z301CYXT) |
| 5     | (pending arrival)  | ata-6       | sdd (ZTT490Z3) |
| 6     | (pending arrival)  | ata-8       | sdf (ZW636A7C) |

---

## Replacement Priority

| Priority | Device | Serial   | Age    | Reason                  |
| -------- | ------ | -------- | ------ | ----------------------- |
| 1st      | sda    | ZFN1KB1Z | 7.1 yr | Same-batch, oldest      |
| 2nd      | sdb    | ZFN1KA96 | 7.1 yr | Same-batch              |
| 3rd      | sde    | ZFN1KHXV | 7.1 yr | Same-batch              |
| 4th      | sdc    | Z301CYXT | 3.9 yr | Wait for SSDs           |
| 5th      | sdd    | ZTT490Z3 | 3.6 yr | Wait for SSDs           |
| 6th      | sdf    | ZW636A7C | 0.5 yr | Newest, lowest priority |

---

## Pre-Migration Steps (Do Once)

### 1. Create fresh Velero backup

```bash
velero backup create pre-ssd-migration --wait
```

### 2. Verify backup completed

```bash
velero backup describe pre-ssd-migration
```

### 3. Record current pool state

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool status zfspv-pool-hdd
```

### 4. Note your SSD serial numbers

Before installing, record each SSD's serial number (printed on label) so you can track which SSD is in which slot.

---

## Per-Drive Replacement Process

Repeat this process for each drive, in order: sda, sdb, sde (then sdc, sdd, sdf when remaining SSDs arrive).

### Step 1: Verify pool is healthy

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool status zfspv-pool-hdd
```

Ensure state is `ONLINE` with no errors. **Do not proceed if pool is degraded.**

### Step 2: Power off server

```bash
talosctl -n 100.69.147.44 shutdown
```

Wait for server to fully power down.

### Step 3: Physically swap the drive

1. Remove the HDD from its slot (note the SATA port/bay number)
2. Install the SSD in the **same physical slot/SATA port**
3. This ensures the new drive gets the same device name (e.g., sda)

### Step 4: Power on and wait for Talos

Power on the server and wait for Talos to boot. Verify it's up:

```bash
talosctl -n 100.69.147.44 health
```

### Step 5: Verify ZFS sees the pool as degraded

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool status zfspv-pool-hdd
```

The pool should show the replaced drive slot as `UNAVAIL` or `REMOVED`.

### Step 6: Identify the new SSD device

```bash
talosctl -n 100.69.147.44 get disks | grep -E 'sd[a-f]|Samsung'
```

The new SSD should appear at the same device path (e.g., `/dev/sda`). Verify it's the SSD by
checking the model shows "Samsung" or the serial matches your SSD.

### Step 7: Replace the drive in ZFS

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool replace zfspv-pool-hdd /dev/sdX
```

Replace `sdX` with the actual device (e.g., `sda`).

If the old device path changed, you may need:

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- \
  zpool replace zfspv-pool-hdd OLD_DEVICE NEW_DEVICE
```

### Step 8: Monitor resilver progress

```bash
watch -n 10 'kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool status zfspv-pool-hdd'
```

You should see something like:

```text
scan: resilver in progress since ...
        X.XXG scanned at Y.YYM/s, X.XXG issued at Z.ZZM/s, 8.70T total
```

Wait for resilver to complete (approximately 30-60 minutes with SSDs).

### Step 9: Verify pool is healthy again

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool status zfspv-pool-hdd
```

Ensure:

- State is `ONLINE`
- All drives show `ONLINE`
- No errors (READ/WRITE/CKSUM all 0)

### Step 10: Clear any historical errors

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool clear zfspv-pool-hdd
```

---

## After All Drives Replaced

### 1. Run a scrub to verify data integrity

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool scrub zfspv-pool-hdd
```

### 2. Monitor scrub progress

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool status zfspv-pool-hdd
```

### 3. Final verification

```bash
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool list zfspv-pool-hdd
```

---

## Troubleshooting

### If device name changes after reboot

If the SSD appears as a different device (e.g., you replaced sda but SSD shows as sdg), use by-id paths:

```bash
# List available by-id paths
talosctl -n 100.69.147.44 ls /dev/disk/by-id/ | grep -E 'ata-Samsung|ata-ST'

# Replace using by-id path
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool replace zfspv-pool-hdd sda /dev/disk/by-id/ata-Samsung_870_EVO_SERIAL-part1
```

### If zpool replace fails with "no such device"

The old device reference may be stale. Try:

```bash
# Export and re-import the pool
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool export zfspv-pool-hdd
kubectl exec -n prometheus zfs-zpool-collector-9z5r7 -- nsenter -t 1 -m -u -i -n -p -- zpool import zfspv-pool-hdd
```

### If resilver is slow

Check for I/O contention. Consider temporarily stopping heavy workloads:

```bash
kubectl scale deployment -n torvalds plex --replicas=0
```

---

## Time Estimates

| Phase                             | Duration       |
| --------------------------------- | -------------- |
| Pre-migration backup              | 5-10 min       |
| Per drive: shutdown + swap + boot | 5-10 min       |
| Per drive: resilver               | 30-60 min      |
| Per drive: verification           | 5 min          |
| **Total per drive**               | **~45-75 min** |
| **Total for 3 drives**            | **~2.5-4 hrs** |
| Final scrub (after all 6)         | 2-4 hours      |

---

## Safety Notes

1. **Never replace more than one drive at a time** - RAIDZ2 can only survive 2 failures, and during
   resilver you have reduced redundancy
2. **Wait for resilver to complete** before starting the next replacement
3. **Keep old HDDs** until you've verified all data is intact on the new SSDs
4. **Do not interrupt a resilver** - this can cause data loss

---

## Replacement Log

### Drive 1: sda (ZFN1KB1Z)

- **Status**: Pending
- **Old Drive**: ST4000DM004-2CV104 / ZFN1KB1Z / 61,843 hours
- **New SSD Serial**:
- **Replacement Date**:
- **Resilver Duration**:
- **Notes**:

### Drive 2: sdb (ZFN1KA96)

- **Status**: Pending
- **Old Drive**: ST4000DM004-2CV104 / ZFN1KA96 / 61,857 hours
- **New SSD Serial**:
- **Replacement Date**:
- **Resilver Duration**:
- **Notes**:

### Drive 3: sde (ZFN1KHXV)

- **Status**: Pending
- **Old Drive**: ST4000DM004-2CV104 / ZFN1KHXV / 61,857 hours
- **New SSD Serial**:
- **Replacement Date**:
- **Resilver Duration**:
- **Notes**:

### Drive 4: sdc (Z301CYXT)

- **Status**: Waiting for SSD delivery
- **Old Drive**: ST4000DM000-1F2168 / Z301CYXT / 34,139 hours
- **New SSD Serial**:
- **Replacement Date**:
- **Resilver Duration**:
- **Notes**:

### Drive 5: sdd (ZTT490Z3)

- **Status**: Waiting for SSD delivery
- **Old Drive**: ST4000DM004-2CV104 / ZTT490Z3 / 31,948 hours
- **New SSD Serial**:
- **Replacement Date**:
- **Resilver Duration**:
- **Notes**:

### Drive 6: sdf (ZW636A7C)

- **Status**: Waiting for SSD delivery
- **Old Drive**: ST4000DM004-2U9104 / ZW636A7C / 4,803 hours
- **New SSD Serial**:
- **Replacement Date**:
- **Resilver Duration**:
- **Notes**:
