---
id: log-2026-06-07-main-ci-failure-seaweedfs-aws-and-dagger-disk
type: log
status: complete
board: false
---

# Main CI Failure — SeaweedFS `aws not found` + Dagger engine disk quota

## Failures (hard, non-soft-fail)

| Job                                                                                                | Root cause                                                                             | Class           |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------- |
| Push birmel, tasknotes-server, scout-for-lol, discord-plays-mario-kart, streambot, trmnl-dashboard | `disk quota exceeded` writing `/var/lib/dagger/worker/{containerdmeta,metadata_v2}.db` | Infra           |
| Apply SeaweedFS Config                                                                             | `tofu apply` → `local-exec` → `/bin/sh: aws: not found` (exit 127)                     | Code regression |

(Soft failures ignored: Large File Check, Trivy Scan.)

## Issue B — SeaweedFS `aws: not found` (FIXED)

- `packages/homelab/src/tofu/seaweedfs/buckets.tf` has `terraform_data` resources with
  `local-exec` provisioners that call the **AWS CLI** (S3 bucket lifecycle config + landing/404
  page seeding for the `public-sjer-red` bucket against SeaweedFS's S3 gateway). Added with the
  public.sjer.red PR-asset host (commit `e0140bb68`).
- `tofuApplyHelper` (`.dagger/src/release.ts`) runs in `TOFU_IMAGE`
  (`ghcr.io/opentofu/opentofu:1.11.7`) which ships only `tofu` — no `aws`. So apply has failed on
  **every** main build since `e0140bb68`, tainting the resources to retry-and-fail each time.
- **Fix:** install `aws-cli` via `apk` for the `seaweedfs` stack, before mounting source so the
  layer caches independently. Verified the opentofu image is Alpine and `apk add --no-cache aws-cli`
  yields aws-cli v2.15.57. Typecheck clean after `dagger develop`; all pre-commit hooks pass.
- **PR:** [#1109](https://github.com/shepherdjerred/monorepo/pull/1109).

## Issue A — Dagger engine disk quota (NEEDS OPERATOR ACTION)

- Error is `EDQUOT` (disk quota exceeded), i.e. the ZFS dataset quota for PVC
  `data-dagger-dagger-helm-engine-0` (namespace `dagger`) was hit during the 195-job build.
- PVC is live at **1Ti** (req=1Ti, status=1Ti) on storage class `zfs-ssd-buildcache`
  (`allowVolumeExpansion: true`).
- `src/cdk8s/src/resources/argo-applications/dagger.ts:321` already intends **2Ti**, with a comment
  noting STS `volumeClaimTemplates` are immutable so the live PVC must be patched manually — that
  patch was never applied. GC config is `maxUsedSpace=600GB, reservedSpace=100GB, minFreeSpace=20%`.
- **Recommended fix (operator, production mutation — not run yet):**

  ```bash
  kubectl patch pvc data-dagger-dagger-helm-engine-0 -n dagger --type merge \
    -p '{"spec":{"resources":{"requests":{"storage":"2Ti"}}}}'
  ```

  Online expansion is supported; this matches the coded intent and raises the ZFS quota,
  unblocking the failed pushes.

- **DONE (2026-06-07):** patched the PVC to 2Ti with operator authorization; resize completed
  online (`capacity=2Ti`, Resizing condition cleared). Disk headroom restored.

## Session Log — 2026-06-07

### Done

- Diagnosed build 3668 main failure: two independent root causes (see tables above).
- Fixed Issue B in `.dagger/src/release.ts` (`tofuApplyHelper` installs `aws-cli` for the
  seaweedfs stack). Verified image base + install + typecheck + hooks. Shipped as PR #1109.

### Remaining

- Merge PR #1109 → triggers a fresh main build that has BOTH the disk headroom (live now) and the
  aws-cli fix, which should be fully green. Re-running the old build 3668 is not worthwhile: its
  commit lacks the aws-cli fix, so the seaweedfs apply would still fail even though the 6 pushes
  would now succeed.

### Caveats

- `dagger develop` bumps `dagger.json` engineVersion to the local CLI's (v0.21.4); reverted to keep
  the diff to release.ts only. Don't commit that bump incidentally.
- GC is configured for 600GB max but the dataset still hit the 1Ti quota during a large parallel
  build — expansion to 2Ti gives headroom; GC effectiveness wasn't separately validated.
