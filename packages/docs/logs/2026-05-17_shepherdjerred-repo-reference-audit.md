# shepherdjerred Repo Reference Audit

## Status

Complete

## Summary

Audited tracked repo content for references to GitHub repositories owned by `shepherdjerred` other than `shepherdjerred/monorepo`. Rewrote URL-style references, badges, changelog links, package metadata, help text, and fixture-loader documentation to point at `monorepo` or to non-repository wording.

The private PR-review fixture corpus is no longer hardcoded as a GitHub repo URL. Temporal now reads `PR_REVIEW_FIXTURES_REPO_URL` from the worker environment, and the homelab Temporal worker wiring exposes that field from its 1Password-backed secret.

The Cooklang plugin release flow no longer hardcodes its external plugin repository either. Dagger now requires a `pluginRepo` argument, and the Buildkite step passes it from `COOKLANG_PLUGIN_REPO`.

## Session Log — 2026-05-17

### Done

- Rewrote old `github.com/shepherdjerred/<repo>` links across package docs, archive docs, practice READMEs, generated changelogs, and package metadata so they no longer reference non-monorepo repos.
- Updated ESLint rule metadata URLs from the old `share` repo to `shepherdjerred/monorepo`.
- Removed the hardcoded private PR-review fixture corpus URL/name from Temporal code and docs; added `PR_REVIEW_FIXTURES_REPO_URL` wiring in `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`.
- Removed the hardcoded Cooklang external plugin repo slug from `.dagger/src/release.ts`, `.dagger/src/index.ts`, `scripts/ci/src/steps/cooklang.ts`, and historical docs.
- Verified with a strict tracked-file audit that no non-`monorepo` GitHub/Travis/Shields/Colab repo references remain.
- Ran `git diff --check`, Prettier check for changed supported files, `bun run --filter='./scripts/ci' typecheck`, `bun run --filter='./scripts/ci' test`, `bun run --filter='./packages/temporal' typecheck`, `bun run --filter='./packages/homelab' typecheck`, `bun run --filter='./packages/eslint-config' test`, and `bun run --filter='./packages/temporal' test` outside the sandbox after the sandbox blocked Temporal's ephemeral server.

### Remaining

- Set `PR_REVIEW_FIXTURES_REPO_URL` in the Temporal worker 1Password item before deploying this change, otherwise the PR-review eval fixture loader will fail fast when invoked.
- Ensure Buildkite provides `COOKLANG_PLUGIN_REPO` before the next Cooklang release, because `cooklang-build-and-publish` now receives that repo slug from the environment.

### Caveats

- The initial sandboxed Temporal test run failed because the sandbox blocked the Temporal ephemeral server and a local port bind. The same suite passed outside the sandbox.
- The audit targets GitHub repository references. It intentionally leaves non-repository coordinates such as GHCR image names, workspace package scopes, Java package names, and TypeScript import aliases intact.
- Direct `.dagger` `tsc` is not currently runnable from this checkout without generated `.dagger/sdk` files and Node test types; the CI pipeline generator typecheck/test suite did pass after the Cooklang Dagger command change.
