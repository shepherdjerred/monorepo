# Main CI failure - relay-docs bucket already exists

## Status

Complete

## Summary

Investigated why `main` CI is red after commit `79cd76c4e`
(`feat(homelab): self-host Relay Server for Obsidian collaboration (#1409)`).
The current `main` build is Buildkite `5128`, which failed in the bundled
OpenTofu apply step.

## Findings

- `origin/main` and local `main` both point at `79cd76c4e`.
- Buildkite build `5128` failed on
  `terraform-apply-tofu-cloudflare-dns-plus-seaweedfs-c`.
- The failing command was the main-only `tofu-apply-all` Dagger step for the
  homelab Tofu stacks.
- The SeaweedFS stack planned `1 to add`:
  `aws_s3_bucket.relay_docs` from
  `packages/homelab/src/tofu/seaweedfs/buckets.tf`.
- Apply failed with:

```text
Error: creating S3 Bucket (relay-docs): BucketAlreadyExists
```

This is state drift, not a build/test failure. The bucket exists in SeaweedFS,
but it is not currently adopted in the `seaweedfs` OpenTofu state, so Tofu tries
to create it and SeaweedFS rejects the create.

This matches the existing incident log in
`packages/docs/logs/2026-07-05_relay-docs-bucket-deleted-by-tofu.md`: the bucket
was created from the relay feature branch, later deleted by an apply from a
checkout without the resource, then manually recreated. Main now has the
resource declaration but no declarative `import {}` block, unlike the older
`stocks_sjer_red` bucket adoption pattern in the same file.

## Likely fix

Adopt the existing bucket into state instead of creating it:

- Add a declarative import block next to `aws_s3_bucket.relay_docs`:

```hcl
import {
  to = aws_s3_bucket.relay_docs
  id = "relay-docs"
}
```

- Consider adding `lifecycle { prevent_destroy = true }` for this data-bearing
  bucket so the branch/main state-footgun cannot delete it again.
- Re-run the main Buildkite job after the fix lands.

No `tofu import`, `tofu apply`, state mutation, or bucket mutation was performed
in this investigation.

## Session Log - 2026-07-05

### Done

- Checked `origin/main` and local `main`; both are at `79cd76c4e`.
- Confirmed latest relevant main Buildkite build is `5128`.
- Read the failed Buildkite job log and narrowed the hard failure to
  `aws_s3_bucket.relay_docs` returning `BucketAlreadyExists`.
- Cross-checked repo docs and code paths:
  `packages/homelab/src/tofu/seaweedfs/buckets.tf`,
  `packages/docs/logs/2026-07-05_relay-docs-bucket-deleted-by-tofu.md`, and
  `scripts/ci/src/pipeline-builder.ts`.

### Remaining

- Implement and merge a state-adoption fix for `relay-docs`.
- Re-run or wait for Buildkite main CI after that fix lands.

### Caveats

- The checkout already had unrelated docs-log changes; they were not touched.
- This was read-only against infra and Buildkite except for API/log reads.
