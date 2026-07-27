---
id: seaweedfs-lifecycle-provider-migration
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-04-05_opentofu-audit-expansion.md
---

# Replace SeaweedFS lifecycle provisioners where the provider supports it

## Context

`packages/homelab/src/tofu/seaweedfs/buckets.tf` still uses `terraform_data`
plus AWS CLI lifecycle calls. The original audit correctly identified the
idempotency gap, but provider compatibility must be tested rather than assumed.

## Remaining

- [ ] Test `aws_s3_bucket_lifecycle_configuration` against the current SeaweedFS endpoint in an isolated plan/apply rehearsal.
- [ ] Migrate supported lifecycle rules, or document the verified provider incompatibility beside the remaining provisioner.

## Comment Log

### 2026-07-27 — extracted from umbrella plan

- Split from the completed 2026-04-05 OpenTofu audit as the remaining bounded lifecycle task.
