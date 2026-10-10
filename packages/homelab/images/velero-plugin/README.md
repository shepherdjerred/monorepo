# Maintained Velero ZFS plugin

This image pins OpenEBS Velero plugin 3.6.0 and applies `chain.patch` before
building. The snapshot format and legacy storage locations remain readable.

`ZFSChain` reads DRR_BEGIN headers and follows `fromGuid` to `toGuid`, ending at
a full stream with `fromGuid=0`. It rejects missing parents, duplicate GUIDs,
and cycles before opening the restore connection. GUIDs are decimal strings
so JSON consumers preserve all 64 bits. Each completed upload also publishes
a versioned `.chain.json` description beside the actual stream.

Full rotation uses the previous stream's ancestry depth. It never counts live
ZFSBackup CRs, whose TTL can remove the records needed by count-based rotation.
The new per-cadence snapshot locations define their incremental counts; the
legacy location retains its original configuration for historical restores.

The init-container entrypoint atomically installs the plugin into `/target`.
It runs as UID/GID 65532; Velero's pod sets `fsGroup: 65532` so its plugins
EmptyDir is group-writable without granting the init container root access.

```bash
docker buildx build --load -t velero-plugin:dev packages/homelab/images/velero-plugin
docker run --rm --tmpfs /target:uid=0,gid=65532,mode=2775 velero-plugin:dev
```

The build runs header, object-storage, rotation, manifest-publication and
lineage tests in Linux. A passing build does not prove recovery: complete an
isolated native restore and check the restored application's integrity before
retiring old recovery points or approving an R2 cleanup manifest.

The reserved `ops-restore-rehearsal` namespace denies all ingress and egress.
Its explicitly excluded `pgdata-temporal-postgresql-0` PVC permits a Temporal
database rehearsal without weakening the PVC classification policy. Restore
only PV/PVC resources there; do not restore production workloads or services.
