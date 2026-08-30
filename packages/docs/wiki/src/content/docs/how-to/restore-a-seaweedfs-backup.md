---
title: Restore a SeaweedFS backup
description: Verify and restore one completed SeaweedFS recovery point into an empty isolated bucket.
sidebar:
  order: 13
---

Use this procedure to inspect or recover one protected SeaweedFS bucket. The
restore command refuses every production bucket named in policy and refuses a
destination containing any object.

## 1. Choose a completed recovery point

Load the dedicated backup credentials into the operator environment, then list
only published completion markers:

```bash
toolkit backup seaweedfs snapshots
```

An interrupted run with manifests but no completion marker is intentionally
absent from this list.

## 2. Verify the recovery point

Run full verification before a restore. This reads and hashes every referenced
R2 object and verifies every compressed manifest:

```bash
SNAPSHOT=...
toolkit backup seaweedfs verify --snapshot "$SNAPSHOT" --full
```

Stop if verification reports a missing object, size mismatch, manifest
mismatch, or checksum mismatch.

## 3. Create an isolated empty destination

Create a temporary bucket that is not named anywhere in the backup policy. Use
restore-only credentials that can write that bucket but cannot write production
buckets. Confirm it is empty with an independent S3 listing before continuing.

## 4. Restore and verify

```bash
SOURCE_BUCKET=relay-docs
DESTINATION_BUCKET=restore-relay-docs-acceptance

toolkit backup seaweedfs restore \
  --snapshot "$SNAPSHOT" \
  --bucket "$SOURCE_BUCKET" \
  --destination-bucket "$DESTINATION_BUCKET"
```

The command streams each payload, preserves content headers and user metadata,
checks the transfer hash, reads the restored object back, and verifies its
SHA-256 checksum before reporting success.

Compare direct source-manifest and destination counts and bytes. For an
application recovery, point an isolated application instance at the restored
bucket and validate its behavior before changing any production configuration.

## 5. Remove the temporary bucket

After acceptance is recorded, delete the temporary objects and bucket using the
same restore-only identity. Never repurpose an acceptance bucket as a production
destination.

## Related

- [SeaweedFS off-site backup reference](/reference/seaweedfs-backups/)
