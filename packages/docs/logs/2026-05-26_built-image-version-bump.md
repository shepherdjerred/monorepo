# Built image version bump

## Status

Complete

## Summary

Refreshed the deployed pins for monorepo-built container images from GHCR. The
pass covers both beta/prod split workloads and the other homelab workloads backed
by `scripts/ci/src/catalog.ts` image targets.

## Session Log — 2026-05-26

### Done

- Queried GHCR for the latest published `2.0.0-<build>` tags and digests for all
  monorepo-built application and infra images.
- Updated `packages/homelab/src/cdk8s/src/versions.ts` pins:
  `scout-for-lol/{beta,prod}` to `2.0.0-2985`,
  `starlight-karma-bot/{beta,prod}` to `2.0.0-2970`, `birmel` to
  `2.0.0-2970`, `discord-plays-pokemon` to `2.0.0-2970`,
  `tasknotes-server` to `2.0.0-2970`, `temporal-worker` to `2.0.0-2985`,
  `trmnl-dashboard` to `2.0.0-2970`, and infra images `caddy-s3proxy` and
  `obsidian-headless` to `2.0.0-2991`.
- Updated `packages/discord-plays-pokemon/compose.yml` to the digest for
  `ghcr.io/shepherdjerred/discord-plays-pokemon:2.0.0-2970`.
- Verification passed:
  - `bun run build` in `packages/homelab/src/cdk8s`
  - `bun test src/versions.test.ts src/helm-template.test.ts` in
    `packages/homelab/src/cdk8s`
  - `bun run scripts/check-docker-images.ts` in `packages/homelab` with registry
    network access: 47 OK / 0 FAIL / 11 SKIP
  - `bun run typecheck` in `packages/homelab/src/cdk8s`
  - `bunx eslint src/versions.ts --fix` in `packages/homelab/src/cdk8s`
  - Prettier check for changed files
  - `git diff --check`

### Remaining

- None.

### Caveats

- `ghcr.io/shepherdjerred/ci-base` was not changed; it is not a beta/prod
  deployment pin and is governed by `.buildkite/ci-image/VERSION` plus the CI
  guard.
- This checkout had no installed dependencies or generated CDK8s `dist/` output
  at the start of verification. Dependencies were installed locally with Bun
  1.3.14, and `dist/` was generated for tests, but neither produced tracked file
  changes.
