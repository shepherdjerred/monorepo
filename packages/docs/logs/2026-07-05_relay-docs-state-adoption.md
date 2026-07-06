# Relay docs bucket state adoption

## Status

Complete

## Summary

Fixed the main CI failure where the SeaweedFS OpenTofu stack tried to create
`relay-docs` even though the bucket already existed.

Buildkite `5128` failed in `tofu-apply-all` with:

```text
Error: creating S3 Bucket (relay-docs): BucketAlreadyExists
```

The bucket exists in SeaweedFS, but main's `seaweedfs` Tofu state had not
adopted it. This patch follows the existing `stocks_sjer_red` pattern and adds a
declarative import block for `aws_s3_bucket.relay_docs`, so the next apply
imports the existing bucket instead of trying to create it.

The bucket also now has `prevent_destroy = true` because it stores live Obsidian
Relay CRDT state and attachments. That makes future branch/main state drift fail
closed instead of deleting the data-bearing bucket.

## Session Log - 2026-07-05

### Done

- Created worktree `.claude/worktrees/relay-docs-state-adoption` on
  `fix/relay-docs-state-adoption` from current `origin/main`.
- Added declarative import for
  `packages/homelab/src/tofu/seaweedfs/buckets.tf`
  `aws_s3_bucket.relay_docs`.
- Added `prevent_destroy` to `aws_s3_bucket.relay_docs`.

### Remaining

- Push the branch and get the fix through CI, or otherwise land it on main.
- After the first successful main apply imports the bucket, the import block can
  remain harmlessly or be removed in a later cleanup.

### Caveats

- No live `tofu apply`, `tofu import`, state mutation, bucket mutation, or
  Kubernetes mutation was performed in this session.
