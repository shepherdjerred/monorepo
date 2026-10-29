# Maintained Velero ZFS plugin

This image pins OpenEBS Velero plugin 3.6.0 and applies `chain.patch` before
building. The snapshot format and legacy storage locations remain readable.

`stream.patch` preserves cloud read errors and requires an actual EOF with
exact expected, read and sent byte counts before a restore transfer completes.
Combined socket readiness and hangup events drain buffered backup bytes;
hangups cannot count an incomplete transfer as successful. Cloud close failures
and the first transfer failure reach the native backup or restore caller.
Diagnostic fields contain byte counts and error classes, without raw cloud
error messages or endpoints.

S3 restores freeze the object size and ETag before sending bytes. A mid-body
unexpected EOF or connection reset can reopen that same conditional object at
the exact forwarded offset, at most three times. Each range must match the
original identity and full size. Authorization, changed objects, close failures
and receiver errors still fail immediately; completion still requires exact
byte counts and a real EOF. Provider diagnostics expose only bounded codes,
numeric HTTP status and fixed transport classes.

Backup writers declare `application/octet-stream`. This avoids the pinned
GoCloud MIME sniffer returning cumulative buffered byte counts when a short
initial ZFS header is followed by a write that crosses its 512-byte threshold;
strict per-write accounting remains enabled.

`ZFSChain` reads DRR_BEGIN headers and follows `fromGuid` to `toGuid`, ending at
a full stream with `fromGuid=0`. It rejects missing parents, duplicate GUIDs,
and cycles before opening the restore connection. GUIDs are decimal strings
so JSON consumers preserve all 64 bits. Each completed upload also publishes
a versioned `.chain.json` description beside the actual stream.

Full rotation uses the previous stream's ancestry depth. It never counts live
ZFSBackup CRs, whose TTL can remove the records needed by count-based rotation.
The new per-cadence snapshot locations define their incremental counts; the
legacy location retains its original configuration for historical restores.

## Expiry sweep

Velero calls `DeleteSnapshot` once per volume when it deletes a backup. The
plugin deletes that volume's ZFSBackup (a missing one is already deleted), then
sweeps the backup's whole schedule+volume family in object storage. The family
is exactly what `ZFSChain` restores from: streams confirmed at their exact key,
so `daily-backup` never claims `daily-backup-v2` objects or `pvc-1` claims
`pvc-12`. The sweep converges whatever order backups expire in, and a rerun is
a no-op.

A backup is retained while any of these name it:

- a Velero Backup that is not `Deleting`;
- backup metadata in a storage location, except backups being deleted;
- a ZFSBackup `snapName` (other than the deleted backup) or any `prevSnapName`.

The deleted backup is also retained while another backup of its schedule has
not settled, because that backup may already have chosen it as a parent.
Retention comes only from these records, never from object age: an upload in
progress has an unsettled Velero Backup and a ZFSBackup naming it, so it stays
retained without a time-based hold. Retained streams protect
their complete GUID ancestry, read from stream headers, so streams without a
`.chain.json` are covered.

The sweep deletes the stream, `.zfsvol` and `.chain.json` of every unprotected
stream named `<schedule>-<yyyymmddhhmmss>`. Other names are never deleted; they
only serve as ancestors. Without a schedule, only the deleted backup's own
objects are eligible. A listing, header, ancestry or duplicate-GUID error
fails `DeleteSnapshot` before any object is deleted. A delete error stops the
sweep; each stream is deleted after its siblings, so a later sweep finds and
finishes it. Velero records the deletion as failed
(`VeleroBackupDeletionFailed`) but still removes the backup's metadata. Its
retry does not call the plugin again, so the next deletion in the family
reclaims what remains.

A retained backup with a broken chain blocks its family's sweep until that
backup is deleted too. Every storage location must share the snapshot bucket
and endpoint, or the sweep fails rather than ignore its metadata. The plugin
uses Velero's `cloud-credentials` and the Velero server's cluster role.

## Installation

The init-container entrypoint atomically installs the plugin into `/target`.
It runs as UID/GID 65532; Velero's pod sets `fsGroup: 65532` so its plugins
EmptyDir is group-writable without granting the init container root access.

```bash
docker buildx build --load -t velero-plugin:dev packages/homelab/images/velero-plugin
docker run --rm --tmpfs /target:uid=0,gid=65532,mode=2775 velero-plugin:dev
```

The build runs header, object-storage, rotation, manifest-publication,
lineage and expiry-sweep tests in Linux. Pull-request CI does not build this
image; main's image step is the first CI run of these tests, so build it
locally before review. A passing build does not prove recovery: complete an
isolated native restore and check the restored application's integrity before
retiring old recovery points or approving an R2 cleanup manifest.
