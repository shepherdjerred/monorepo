---
id: plan-2026-06-14-ci-artifact-retention
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# CI Artifact Retention — Archives + Cleanup

## Context

Today the monorepo retains almost no historical build artifacts. Static-site
deploys are `aws s3 sync --delete` (zero history), Buildkite artifacts
(knip/trivy/semgrep) live only on the BK build page, and
test/coverage/lint output is not persisted at all. Meanwhile the `sccache`
and `bazel-cache` SeaweedFS buckets exist for tooling we no longer use.

Goals:

1. Keep a historical snapshot of every deployed static site.
2. Mirror Buildkite artifacts (quality reports today, more later) to S3.
3. Capture test / coverage / lint reports to S3.
4. Delete `sccache` + `bazel-cache` buckets and every reference to them.

All uploads go to SeaweedFS (`https://seaweedfs.sjer.red`) via the existing
`SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY` env vars that the CI
pod already mounts (`scripts/ci/src/steps/sites.ts:110-112`).

Shape: **one PR** for everything below.

## 1. Static-site archive on every deploy

**Where the deploy happens:** `.dagger/src/release.ts` →
`deploySiteHelper()` (lines 451-572). Currently runs `aws s3 sync <dist>
s3://<bucket>/ --endpoint-url https://seaweedfs.sjer.red --delete`.

**Sites in scope** (`scripts/ci/src/catalog.ts:142-218`): `sjer.red`, `resume`,
`webring`, `cooklang-rich-preview`, `stocks-sjer-red`, `scout-frontend`,
`scout-frontend-beta`, `better-skill-capped`.

**Change:** Before the `aws s3 sync ... --delete` call, zip the build dir and
upload to a versioned key:

```
s3://ci-archives/sites/<site>/<BUILDKITE_BUILD_NUMBER>-<BUILDKITE_COMMIT_SHORT>.zip
```

- Skip when `DRYRUN=true` (PRs).
- `zip -r -q` is fine; sites are small (KB–single-digit MB).
- Implement once in `deploySiteHelper()`, before the sync step — every site
  inherits it automatically.

## 2. Test / coverage / lint reports to S3 — wire everything now

**Currently emitted** (`scripts/ci/src/steps/quality.ts`,
`.dagger/src/quality.ts`):

- `/tmp/knip.txt`, `/tmp/trivy.txt`, `/tmp/semgrep.txt` — BK artifact only.

**Add (one round of CI churn):**

- `bun test --coverage` in the Dagger `testHelper`
  (`.dagger/src/typescript.ts:59-79`) emitting lcov to
  `/tmp/coverage/lcov.info`.
- eslint JSON output to `/tmp/eslint.json` (`-f json -o /tmp/eslint.json` in
  `quality.ts`).
- JaCoCo reports from `mavenCoverageHelper` (`.dagger/src/java.ts:46-62`) —
  already generated, just not uploaded.

**Upload destination:**

```
s3://ci-archives/reports/<BUILDKITE_PIPELINE_SLUG>/<BUILDKITE_BUILD_NUMBER>/<report>
```

Env vars confirmed in `scripts/ci/src/lib/buildkite.ts`.

## 3. Buildkite artifacts to S3 too

Continue uploading to BK (build-page convenience), and additionally mirror to
`s3://ci-archives/buildkite/<pipeline>/<build>/<artifact>`. Implement as one
helper alongside §2, called from `quality.ts` after each report file is
written.

## 4. New bucket: `ci-archives`

Add to `packages/homelab/src/tofu/seaweedfs/buckets.tf`:

- Single bucket `ci-archives` with three logical prefixes (`sites/`,
  `reports/`, `buildkite/`).
- Single lifecycle rule: **365-day expiration** across the whole bucket
  (symmetric, matches `pr/assets/` and `llm-archive`).
- Path-style, no public read (private — accessed via SeaweedFS creds).

## 5. Remove `sccache` and `bazel-cache`

Confirmed unused; remove every reference in the same PR.

- `packages/homelab/src/tofu/seaweedfs/buckets.tf:105-160` — delete both
  `aws_s3_bucket` blocks + their lifecycle rules.
- Any IAM user / policy / DNS resource in `packages/homelab/src/tofu/` keyed
  to `sccache` or `bazel-cache`.
- Any 1Password `OnePasswordItem` in homelab cdk8s naming sccache/bazel.
- Repo-wide grep (`scripts/ci/`, `.dagger/`, `.buildkite/`,
  `packages/dotfiles/`, `packages/docs/`, all `AGENTS.md`/`CLAUDE.md`,
  `.mise.toml`, `.bazelrc`, `WORKSPACE`, `MODULE.bazel`, `BUILD`,
  `.bazelversion`) — remove every hit.
- Search for env vars `SCCACHE_*`, `RUSTC_WRAPPER`, `BAZEL_*` in CI
  containers and remove.

After `tofu apply`, the buckets and their contents are gone — no migration
needed.

## Shared upload helper

One Dagger helper (`.dagger/src/archive.ts` — new) that wraps
`aws s3 cp <local> s3://ci-archives/<key> --endpoint-url
https://seaweedfs.sjer.red`, mounting the existing SeaweedFS secrets. Reused
by §1, §2, §3. Pattern lifted from `deploySiteHelper()`
(`.dagger/src/release.ts:562-571`).

## Files to modify

- `.dagger/src/release.ts` — add archive step to `deploySiteHelper()`.
- `.dagger/src/archive.ts` — new shared upload helper.
- `.dagger/src/quality.ts` — emit eslint JSON; mirror knip/trivy/semgrep/eslint
  to S3.
- `.dagger/src/typescript.ts` — `bun test --coverage`, emit + upload lcov.
- `.dagger/src/java.ts` — upload jacoco reports.
- `scripts/ci/src/steps/quality.ts` — call archive helper after each report.
- `packages/homelab/src/tofu/seaweedfs/buckets.tf` — add `ci-archives`, drop
  `sccache` + `bazel-cache`.
- Any remaining sccache/bazel references identified by repo grep.

## Verification

1. `cd packages/homelab && tofu plan` — confirm `ci-archives` created and
   `sccache`/`bazel-cache` destroyed; no other diffs.
2. Open a throwaway PR touching a static site (e.g. `packages/resume`); BK
   build should:
   - Skip archive on PR (`DRYRUN=true`).
   - In a follow-up build on `main`, produce
     `s3://ci-archives/sites/resume/<build#>-<sha>.zip`. Verify with
     `aws s3 ls s3://ci-archives/sites/resume/ --endpoint-url https://seaweedfs.sjer.red`.
3. Inspect a `main` build: confirm
   `s3://ci-archives/reports/<pipeline>/<build>/knip.txt`,
   `eslint.json`, `coverage/lcov.info` exist and BK still shows them.
4. `grep -rIn -E 'sccache|bazel-cache|SCCACHE|RUSTC_WRAPPER|\.bazelrc' .`
   from repo root after removal — zero hits outside
   `packages/docs/archive/` (history).
5. Download an archived site zip, unzip, open `index.html` — confirms the
   snapshot is usable for rollback.

## Remaining

- [ ] Complete and verify the work described in `CI Artifact Retention — Archives + Cleanup`.
