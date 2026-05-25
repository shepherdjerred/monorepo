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

## Session Log - 2026-05-24

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
