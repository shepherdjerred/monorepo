## Status

Complete

# Main CI Status Check

Checked Buildkite for the `sjerred/monorepo` pipeline on branch `main`.

Latest main build:

- Build: `2897`
- State: `failed`
- Commit: `880a90035cda82ec5e4946518fa7d0e55da0680f`
- Message: `Merge pull request #925 from shepherdjerred/claude/objective-haibt-bc7dc0`
- URL: https://buildkite.com/sjerred/monorepo/builds/2897
- Created: `2026-05-24T22:55:16.448Z`
- Finished: `2026-05-24T23:03:31.037Z`

No `main` builds were running or scheduled at check time.

## Findings

The latest non-canceled main builds were all red: `2897`, `2894`, `2884`, and `2874`. Build `2883` was canceled by a newer main build.

Build `2897` had 12 failed jobs:

- Image pushes for `birmel`, `tasknotes-server`, `scout-for-lol`, `discord-plays-pokemon`, `starlight-karma-bot`, `temporal-worker`, `trmnl-dashboard`, `caddy-s3proxy`, and `obsidian-headless`.
- `cooklang-publish`.
- `deploy-scout-frontend-beta`.
- `tofu-github`.

The image push failures are missing `GHCR_TOKEN` in the Dagger secret environment:

```text
secret env var not found: "GHC..."
```

The Scout beta frontend deploy fails during Astro static route rendering because the ad tracking public env vars are absent:

```text
PUBLIC_PINTEREST_TAG_ID: Invalid input: expected string, received undefined
PUBLIC_REDDIT_PIXEL_ID: Invalid input: expected string, received undefined
```

The GitHub Tofu apply is trying to create multiple repositories and update the main ruleset, but the GitHub App token cannot perform those operations:

```text
POST https://api.github.com/user/repos: 403 Resource not accessible by integration []
PUT https://api.github.com/repos/shepherdjerred/monorepo/rulesets/11098884: 403 Resource not accessible by integration []
```

`cooklang-publish` also failed while installing Debian packages in the Dagger container:

```text
E: Failed to fetch ... 404 Not Found
E: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?
```

## Fixes Applied

- Added a Buildkite-side `GHCR_TOKEN` fallback to the existing `GH_TOKEN` secret for image push jobs and the CI base image push. The live Kubernetes secret has `GH_TOKEN`, but not `GHCR_TOKEN`.
- Added explicit non-tracking Scout beta build placeholders for `PUBLIC_PINTEREST_TAG_ID` and `PUBLIC_REDDIT_PIXEL_ID`, so beta deploys can statically render without requiring production ad pixel IDs.
- Switched the GitHub OpenTofu stack from provider `app_auth {}` to `token = var.github_token`, and changed only the `github` Tofu CI steps to pass `--github-token env:TOFU_GITHUB_TOKEN`.
- Consolidated Dagger `apt-get update` and `apt-get install` into one release-helper layer for package installs, including Cooklang publish, to avoid stale Debian package indexes.

## Verification

- `bun run --filter='./scripts/ci' test`
- `bun run --filter='./scripts/ci' typecheck`
- `dagger develop`
- `cd .dagger && bunx tsc --noEmit`
- `cd .dagger && bun test`
- `bun run scripts/check-dagger-hygiene.ts`
- `tofu fmt -check packages/homelab/src/tofu/github`
- Generated a `FULL_BUILD=true` main pipeline snapshot and confirmed:
  - image push commands export `GHCR_TOKEN` from `GH_TOKEN` when needed;
  - `deploy-scout-frontend-beta` injects placeholder public ad IDs in the build command;
  - `tofu-github` passes `--github-token env:TOFU_GITHUB_TOKEN`.

## Post-Merge Session Log - 2026-05-24

### Done

- Loaded Buildkite guidance and checked live Buildkite state for `sjerred/monorepo` on `main`.
- Confirmed latest main build `2897` is failed and no main builds are currently running or queued.
- Pulled representative failed job logs for image push, Cooklang publish, Scout beta deploy, and GitHub Tofu apply.
- Implemented fixes for all four observed failure classes in `.dagger/src/`, `scripts/ci/src/`, and `packages/homelab/src/tofu/github/`.
- Verified the focused CI/Dagger/OpenTofu checks listed above.

### Remaining

- Land these changes and let Buildkite run `main` again to prove the live secret scopes, especially that `GH_TOKEN` can write GHCR packages and `TOFU_GITHUB_TOKEN` can manage the GitHub repositories/ruleset.

### Caveats

- Local checks passed, but the final proof is a live Buildkite main build because the failing surfaces are CI secrets and external APIs.
- `dagger develop` required access to the local Docker/OrbStack socket to regenerate the gitignored `.dagger/sdk`.

### Summary

Buildkite build `2897` on `main` failed across image pushes, Cooklang publish, Scout beta deploy, and the GitHub OpenTofu apply. This session traced those failures to missing CI secrets, required public build-time Scout env vars, GitHub App permission limits, and stale Debian package indexes, then implemented the corresponding CI, Dagger, and OpenTofu fixes with focused local verification.

## Post-Merge Follow-Up

After PR #926 merged, Buildkite build `2904` ran on `main` at commit `1d3f273c5f1b76e94ef60f55dadcd2f4222be376` and still had three hard failures:

- `deploy-scout-frontend-beta` reached the S3 upload step, then failed because the `scout-frontend-beta` bucket did not exist in the SeaweedFS OpenTofu bucket stack.
- `cooklang-publish` minted a GitHub App token, but the generated askpass helper returned blank credentials because the outer shell `printf` consumed the inner `%s` placeholders.
- `tofu-github` rejected the live CI GitHub token because the OpenTofu variable validation only accepted fine-grained PATs.

## Session Log - 2026-05-24

### Done

- Rechecked post-merge Buildkite build `2904` and filtered to hard failures only.
- Added the missing `scout-frontend-beta` SeaweedFS bucket in `packages/homelab/src/tofu/seaweedfs/buckets.tf`.
- Updated the Dagger GitHub App askpass helper in `.dagger/src/release.ts` to return GitHub's expected HTTPS token username for username prompts and the minted token for password prompts, using plain HTTPS clone URLs.
- Relaxed `packages/homelab/src/tofu/github/variables.tf` and its README entry so the GitHub provider accepts the token classes CI uses.
- Verified with Dagger hygiene, suppression checks, Dagger TypeScript typecheck, Dagger unit tests, targeted OpenTofu formatting checks, and an askpass smoke test.

### Remaining

- Land the follow-up PR and let Buildkite rerun main to verify the three post-merge failures are gone.

### Caveats

- Full local `tofu validate` is blocked by local provider cache/plugin issues for the GitHub provider and missing cached AWS provider for SeaweedFS, so the local OpenTofu verification was limited to formatting and focused HCL review.
