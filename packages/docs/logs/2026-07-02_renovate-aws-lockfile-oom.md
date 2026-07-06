# Renovate aws `.terraform.lock.hcl` OOM — root cause & fix

## Status

Complete

## Summary

The Mend-hosted Renovate job for `shepherdjerred/monorepo` was **dying mid-run, twice in a
row**, while refreshing the OpenTofu provider lock for `hashicorp/aws`. Because the process
was killed before reaching the end-of-run step, **Dependency Dashboard #481 never
regenerated** — it stayed byte-for-byte identical across fetches, with the aws-lockfile
`unlimit` box and the kubernetes recreate box stuck checked.

## Evidence (from the downloaded job log)

`~/Downloads/shepherdjerred_monorepo_2026-07-03_01-34_*.log` (Renovate v43.242.2, run
2026-07-03 01:29–01:33 UTC):

- 3,455 JSON lines, **0 warn / 0 error** severity — the process just stops.
- Last line: `Calculating hashes for 15 builds | branch=renovate/aws-6.x-lockfile` at
  01:33:15, then nothing. No `Repository finished`. Clean death with no exception =
  **OOM-kill / job timeout**.
- Preceding lines: `Getting zip hashes for 1 shasum URL(s)` → `Got 15 zip hashes` →
  `Calculating hashes for 15 builds` for `hashicorp/aws@6.47.0`.
- The 504 on `renovate/kubernetes-kubernetes-1.x` was a **red herring** — that PR
  (#1356) got created fine on retry; the 4 other PRs (#1357–#1360) also exist.

## Root cause

Renovate refreshes `.terraform.lock.hcl` by recomputing the `h1:` hashes **itself** (it
does not shell out to tofu):

- `lib/modules/manager/terraform/lockfile/index.ts` → `TerraformProviderHash.createHashes`
  → `terraform-provider` datasource `getBuilds(registryURL, repo, version)` →
  `calculateHashScheme1Hashes(builds)`.
- `getBuilds` returns **every published platform** (aws ships ~15). Renovate downloads each
  provider zip (`~150–200 MB` for aws v6) with `concurrency=16` and extracts+hashes it.
  15 × ~200 MB fetched in parallel → memory spike → OOM on the Mend runner.
- Other providers (github, cloudflare, tailscale, devopsarr/\*, …) have many hashes too
  (arr has 42) but tiny binaries, so they never OOM. **aws is uniquely heavy.**

### Dead ends ruled out

- **`tofu providers lock -platform=…` does NOT prune the lock.** Verified empirically:
  regenerating the seaweedfs lock with a single `-platform=linux_amd64` still writes
  **15 `h1:` + 15 `zh:`**. OpenTofu 1.12 records h1 for all platforms from the signed
  `SHA256SUMS` document without downloading them, so platform restriction is a no-op here.
- **Manually pruning the lock's hash list won't help either** — Renovate hashes whatever
  `getBuilds` returns (all platforms), not the set present in the lock file.

## Fix

`renovate.json` — add a `packageRules` entry scoped to the aws provider only:

```json
{
  "matchDatasources": ["terraform-provider"],
  "matchPackageNames": ["hashicorp/aws"],
  "skipArtifactsUpdate": true
}
```

`skipArtifactsUpdate` (formerly `updateLockFiles`; confirmed present at v43.242.2) makes
Renovate skip the lock-hash step entirely. The in-range `renovate/aws-6.x-lockfile` branch
(whose only artifact is the lock) is no longer created → no OOM. aws **version /
constraint-bump PRs still surface** normally. Validated with `renovate-config-validator`.

## Trade-off / follow-up

- The aws lock is **no longer auto-maintained**. When an aws **constraint** bump lands
  (e.g. `~> 6.44` → `~> 7.0`), CI runs plain `tofu init -input=false`
  (`.dagger/src/release.ts`, no `-upgrade`), so a stale lock **fails fast and visibly** on
  that PR. Regenerate it manually with `tofu init -upgrade`:

```bash
cd packages/homelab/src/tofu/seaweedfs && tofu init -upgrade
```

- In-range aws patch drift within the current major is intentionally frozen until a human
  runs the above — acceptable for a homelab S3/seaweedfs provider.

## Interim action

User unchecked `unlimit-branch=renovate/aws-6.x-lockfile` on #481 to stop the crash loop
before this config change lands.
