---
id: velero-aws-plugin-r2-tagging
status: active
origin: packages/docs/plans/2026-06-28_velero-r2-tagging-outage.md
source_marker: false
---

# Unpin `velero-plugin-for-aws` once R2 stops rejecting `x-amz-tagging`

## What

`velero/velero-plugin-for-aws` is pinned to **v1.14.0** in
`packages/homelab/src/cdk8s/src/versions.ts`, with a Renovate `allowedVersions: "<1.14.1"`
rule in `renovate.json` blocking the auto-bump.

**Why:** the plugin always sets a `Tagging` field on `PutObject` (often empty). v1.14.1's
dependency bump pulled a newer `aws-sdk-go-v2` that emits an **empty `x-amz-tagging` header
on the wire**; Cloudflare R2 (our Velero backup store, bucket `homelab`) does not implement
object tagging and returns `501 NotImplemented: Header 'x-amz-tagging' with value '' not
implemented`. (v1.14.0's older SDK didn't emit the empty header, so it works.) This fails
Velero's backup-metadata upload, so **every backup after the v1.14.1 deploy
(PR #1307, `dd66cb2d6`, 2026-06-21) was marked `Failed`** — last good backup
`weekly-backup-20260615`. Because the metadata tarball was never written, expiry-time
cleanup (`DeleteItemAction` → openebs `DeleteSnapshot`) was skipped on a 404, orphaning
ZFS snapshots and R2 data (PagerDuty **#5860**, **#5849**).

Evidence (velero pod log):

```
Error uploading log file ... PutObject torvalds/backups/.../...-logs.gz:
StatusCode: 501 ... NotImplemented: Header 'x-amz-tagging' with value '' not implemented
```

## Upstream status

- The targeted fix is **[velero-io/velero-plugin-for-aws#299](https://github.com/velero-io/velero-plugin-for-aws/pull/299)**
  "Only set PutObject Tagging when tags are configured" — **merged to `main` 2026-06-15**.
  Related: #303 (closed), #304 (open).
- **It is NOT in the latest release `v1.14.2` (2026-06-26)** — that release is only
  CVE dependency bumps + KMS support (backports #302/#305/#306), so v1.14.2 is **unproven on
  R2** and may still 501. Do not assume v1.14.2 fixes this without testing.

## Definition of done (unpin criteria)

1. A `velero-plugin-for-aws` release that **contains #299** (or otherwise restores S3-compat
   with Cloudflare R2). Watch for #299 being backported to a `1.14.x` release or a `1.15.x`.
2. Validate the candidate **against R2** (throwaway bucket / `dagger`-style check) — confirm a
   `PutObject` succeeds without the 501. (v1.14.2 may be worth testing directly.)
3. Bump `versions.ts` to the fixed version, remove the `renovate.json` `allowedVersions`
   rule, redeploy, and confirm the next 6hourly backup reaches `Completed` with a tarball
   under `torvalds/backups/backups/<name>/`.
4. Delete this todo + the related GitHub tracking issue in the same change.

## Notes

- Last known-good version is **v1.14.0** (backups were green through 2026-06-15).
- The openebs ZFS plugin uses a separate uploader (no tagging header), so volume _data_
  still lands in `zfspv-incr/` even while metadata fails — which is why R2 kept growing
  ~9 GiB/day with unrestorable data during the outage.
