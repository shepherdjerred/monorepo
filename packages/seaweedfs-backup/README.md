# SeaweedFS off-site backup

`@shepherdjerred/seaweedfs-backup` creates immutable, object-level recovery
points from SeaweedFS in a dedicated Cloudflare R2 bucket. The language-neutral
policy in `policy.json` classifies every source bucket; `policy.schema.json`
describes its format.

Daily protection includes the `glitter-boys` bucket's immutable launcher
installers, updater archives, and signed manifests. Restore these exact published
bytes; rebuilding produces different timestamped signatures.

The `delivery-artifacts` bucket is also protected daily without suffix
exclusions. Restore its original archive bytes alongside the Delivery catalog;
deployment and rollback history refer to their immutable digests.

Changed objects stream between S3-compatible endpoints and are verified by
SHA-256 read-back. Unchanged objects are reused by source bucket, key, size,
ETag, and modification time. A snapshot becomes visible only when every
compressed NDJSON bucket manifest has been written and the run completion
marker is published.

`replicateObject` (`@shepherdjerred/seaweedfs-backup/replicate`) copies one
object ahead of the next snapshot, at the content-addressed key that snapshot
would choose, and checks the read-back SHA-256 against the digest the caller
already holds. Delivery uses it from the `backup` Temporal worker to replicate
self-hosted artifacts to R2 before a build is verified; the next daily snapshot
reuses the copy and its manifest references the same bytes.

Retention keeps 28 six-hourly, 30 Pacific daily, 8 Pacific weekly, and 12
Pacific monthly recovery points. Garbage collection is two-phase: candidates
must be unreferenced for 35 days, belong to a candidate set at least seven days
old, and remain unreferenced after rebuilding the complete retained protection
set. The object-lock age and unchanged modification time are checked separately.

Retention and GC accept `BackupMaintenanceHooks` with an `AbortSignal` and
aggregate progress callback. Cancellation stops subsequent deletes and aborts
maintenance S3 requests and streaming manifest reads. Buffered candidate-set
uploads pass that signal to the HTTP request. Temporal sends a heartbeat every
30 seconds during maintenance I/O and clears it when the Activity exits.

The Temporal worker uses only the backup credentials. Restore credentials are
separate and available only to the operator CLI.

```bash
toolkit backup seaweedfs snapshots
toolkit backup seaweedfs verify --snapshot <id> --full
toolkit backup seaweedfs restore --snapshot <id> --bucket <source> \
  --destination-bucket <empty-isolated-bucket>
```

## Cold-start restore

Restore refuses every bucket named in `policy.json` and the backup bucket. A
cold start, where the cluster is rebuilt from nothing, must still return
`delivery-artifacts` and `storm-forum-releases` to the fresh SeaweedFS before
Delivery can verify or redeploy. `--cold-start` is the only way to do that:

```bash
toolkit backup seaweedfs restore --cold-start \
  --record cold-start-delivery-artifacts.ndjson \
  --snapshot <id> --bucket delivery-artifacts \
  --destination-bucket delivery-artifacts
```

The mode relaxes only the production-bucket refusal. Every other check stays:

- The destination must be the same bucket as `--bucket`; a production bucket
  never receives another bucket's backup. The backup bucket is always refused.
- The destination bucket must already exist, and a full listing must return no
  objects. Any object fails the restore, naming the count and the first key.
- Each key is checked with `HEAD` immediately before it is written, so an
  object that appears mid-restore stops the run instead of being overwritten.
- Transfer and read-back SHA-256 verification are unchanged.

`--record <file>` is required with `--cold-start`. The file is created
exclusively (an existing file is an error) and holds NDJSON: a
`cold-start-restore` header, one `object` line per verified key with its size
and SHA-256, then a `complete` or `failed` line. A refused or interrupted run
therefore leaves evidence of what, if anything, was restored. Retry with a new
record path once the destination bucket is empty again.

The full cold-start recovery order is the Delivery model's bootstrap chain
([`packages/delivery/docs/model.md`](../delivery/docs/model.md), section 6).
