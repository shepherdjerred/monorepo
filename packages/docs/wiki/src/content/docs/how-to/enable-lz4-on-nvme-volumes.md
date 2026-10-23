---
title: Enable lz4 on existing NVMe volumes
description: Turn on lz4 compression for the production NVMe pool's existing datasets through their ZFSVolume resources, without changing any claim.
---

Patch each uncompressed `ZFSVolume` on torvalds' `zfspv-pool-nvme` pool to `compression: lz4` with the reviewed one-shot script, then read it back.

New `ZfsNvmeVolume` claims already get lz4 from the `zfs-ssd-lz4` class.
Claims provisioned earlier stay on `zfs-ssd` in Git, because a claim's class is immutable.
This guide moves their datasets to lz4 in place.
Only data written afterwards is compressed.

## 1. Deploy the release first

Run this only after the release that made lz4 the default has synced.
That release is what keeps new claims off the uncompressed class.

## 2. Review the dry run

From `packages/homelab`, run the [script](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/scripts/zfs-nvme-lz4.ts) without arguments:

```bash
bun scripts/zfs-nvme-lz4.ts
```

It lists every torvalds NVMe dataset with its claim, its `ZFSVolume` value, and either `lz4` or `skip` with a reason.
It then validates each patch with a server-side dry run and changes nothing.

| Dataset state                             | Script action  |
| ----------------------------------------- | -------------- |
| Live `compression=off`, CR `off` or unset | Patched to lz4 |
| Live compression already on or lz4        | Skipped        |
| CR declares another value                 | Skipped        |
| Not `Ready`, being deleted, or a zvol     | Skipped        |

Stop if a dataset you expected is skipped, or if the dry run reports an admission error.

## 3. Apply and read back

```bash
bun scripts/zfs-nvme-lz4.ts --apply
```

The script patches each candidate, then polls for up to two minutes.
It exits non-zero unless both the `ZFSVolume` field and the live `zfs get compression` read `lz4`.

:::caution
Do not use `zfs set` directly.
The ZFS LocalPV node agent re-applies the `ZFSVolume` properties when it restarts, so a hand-set dataset falls back to `off`.
:::

A rerun is safe.
Patched volumes declare `lz4` and are skipped.

## 4. Confirm the effect

Over the following day, compare each dataset's `compressratio` with its value before the change.
Watch the NVMe write-budget and pool-amplification panels on the SMART Monitoring dashboard.
Their recording rules live in [`nvme.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/storage/nvme.ts).

## Related

- [Expand a ZFS workload volume](/how-to/expand-a-zfs-workload-volume/)
- [Reclaim a released volume](/how-to/reclaim-a-released-volume/)
