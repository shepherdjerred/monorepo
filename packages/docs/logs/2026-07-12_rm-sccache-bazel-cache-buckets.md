# Remove sccache + bazel-cache SeaweedFS buckets

## Status

Complete

## Context

The `sccache` and `bazel-cache` SeaweedFS S3 buckets are leftovers from the
retired Bazel/sccache build tooling (the repo has since moved CI to Dagger; see
`packages/docs/archive/bazel/` and `packages/docs/plans/2026-07-11_ci-replatform-dagger-exit.md`).
They had no live consumers, but kept reappearing after manual deletion because
both were declared as OpenTofu resources in
`packages/homelab/src/tofu/seaweedfs/buckets.tf`. Any `tofu apply` of the
`seaweedfs` stack — which now runs automatically in CI on homelab changes — saw
the missing bucket as drift and re-`CreateBucket`d it. Deleting the bucket by
hand without removing the resource is a losing game.

## Verification that removal is safe

- **No live consumers.** `rg` for `RUSTC_WRAPPER`/`SCCACHE_*`/`sccache` and
  `bazel-cache`/`remote_cache`/`.bazelrc` across the tree (excluding docs,
  archive, skills) returned nothing. Only a stray dead `packages/cooklang-for-obsidian/BUILD.bazel`
  remains, which is not a cache consumer.
- **Standalone resources.** Neither bucket is referenced by any output or other
  resource in the `seaweedfs` tofu module; each only had its own
  `terraform_data` lifecycle block.
- **Clean tofu destroy on next apply.** SeaweedFS honors a single S3
  `DeleteBucket` on a non-empty collection (evidence: the 2026-07-05 relay-docs
  incident, where a tofu destroy issued `delete collection: collection:"relay-docs"`
  and removed 7 populated volumes). So plain resource removal → the next
  `seaweedfs`-stack apply destroys both buckets, data and all — no
  `force_destroy` and no manual pre-emptying required. Since these are disposable
  caches, deleting the data is the intent.

## Changes

- `packages/homelab/src/tofu/seaweedfs/buckets.tf`: removed
  `aws_s3_bucket.sccache` + `terraform_data.sccache_lifecycle` and
  `aws_s3_bucket.bazel_cache` + `terraform_data.bazel_cache_lifecycle`.
- Deleted `packages/homelab/scripts/seaweedfs/setup-sccache-bucket.sh` (the
  orphaned bucket-setup script; its lifecycle was already superseded by the
  now-removed `terraform_data`).
- `packages/homelab/src/tofu/README.md`: dropped the "build cache (sccache)"
  mention and the `setup-sccache-bucket.sh` sentence from the SeaweedFS section.

## Verification

- `tofu fmt -check seaweedfs/` → OK
- `tofu -chdir=seaweedfs init -backend=false && tofu -chdir=seaweedfs validate`
  → "Success! The configuration is valid."

## Deploy note

On merge, the `seaweedfs`-stack `tofu apply` in CI will **destroy** both buckets
(and their contents). No manual step required. There is no rollback of the
cached data, which is intended.

## Session Log — 2026-07-12

### Done

- Root-caused "buckets keep coming back" to the tofu-managed resources in
  `buckets.tf` (not the setup script).
- Removed both bucket resources + lifecycle blocks, deleted the setup script,
  updated the tofu README. Validated with `tofu validate`/`fmt`.

### Remaining

- Merge → CI `seaweedfs` apply destroys the buckets. Confirm they're gone
  afterward (`aws s3 ls --profile seaweedfs --endpoint-url https://seaweedfs-s3.tailnet-1a49.ts.net`).

### Caveats

- Dead `packages/cooklang-for-obsidian/BUILD.bazel` left in place — unrelated to
  the buckets, out of scope here.
