# Backblaze backup buckets

This operator-only stack creates the private backup buckets and a key scoped
to each one. The master application key is `B2_APPLICATION_KEY_ID` and
`B2_APPLICATION_KEY`. Create the Backblaze account in `us-west-004`. CI can
validate this stack. The wrapper rejects every live operation from CI.

Scoped keys are written into 1Password items in the homelab vault. The
1Password provider uses the desktop app for the account named by `OP_ACCOUNT`.
State and plans are encrypted with `TOFU_STATE_ENCRYPTION_PASSPHRASE`.

Velero writes its backups and ZFS streams to `sjerred-velero` with the
`backblaze-velero` item. That item's `cloud` field is the AWS credentials file
Velero mounts. Backups taken before the move stay in the R2 `homelab` bucket
and were not copied.

The `seaweedfs-backup` Deployment (`weed filer.backup`) copies SeaweedFS
objects to `seaweedfs-backups` with the `backblaze-seaweedfs-backups` item.
`sjerred-postgres-wal` has no writer: WAL-G, which would have used it, was
retired.

A change to `keys.tf` needs an operator apply before a workload reads the
changed item.

```sh
bun packages/homelab/scripts/tofu/tofu-stack.ts backblaze validate
```
