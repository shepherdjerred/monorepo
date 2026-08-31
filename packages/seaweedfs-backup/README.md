# SeaweedFS off-site backup

`@shepherdjerred/seaweedfs-backup` creates immutable, object-level recovery
points from SeaweedFS in a dedicated Cloudflare R2 bucket. The language-neutral
policy in `policy.json` classifies every source bucket; `policy.schema.json`
describes its format.

Changed objects stream between S3-compatible endpoints and are verified by
SHA-256 read-back. Unchanged objects are reused by source bucket, key, size,
ETag, and modification time. A snapshot becomes visible only when every
compressed NDJSON bucket manifest has been written and the run completion
marker is published.

Retention keeps 28 six-hourly, 30 Pacific daily, 8 Pacific weekly, and 12
Pacific monthly recovery points. Garbage collection is two-phase: candidates
must be unreferenced for 35 days, wait at least seven more days, and remain
unreferenced after rebuilding the complete retained protection set.

The Temporal worker uses only the backup credentials. Restore credentials are
separate and available only to the operator CLI.

```bash
toolkit backup seaweedfs snapshots
toolkit backup seaweedfs verify --snapshot <id> --full
toolkit backup seaweedfs restore --snapshot <id> --bucket <source> \
  --destination-bucket <empty-isolated-bucket>
```
