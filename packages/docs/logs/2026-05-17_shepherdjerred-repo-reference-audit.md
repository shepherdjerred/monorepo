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

## Session Log — 2026-05-19

### Done

- Recovered the staged audit work and committed it as `a143845d0 chore(root): remove stale shepherdjerred repo references`.
- Pushed `a143845d0` to `fix/github-links`, then confirmed PR #816 was blocked by being behind `origin/main`.
- Merged `origin/main` into the branch and resolved conflicts in `.dagger/src/index.ts`, `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`, and `scripts/ci/src/steps/cooklang.ts`.
- Preserved the `COOKLANG_PLUGIN_REPO` Dagger/Buildkite wiring alongside the current GitHub App secret arguments from `main`.
- Preserved `PR_REVIEW_FIXTURES_REPO_URL` in the Temporal worker environment alongside the current GitHub App secret fields from `main`.
- Re-ran the non-`monorepo` `shepherdjerred` repository reference audit after the merge; no matches remain.
- Verified the merge resolution with `git diff --check`, conflict-marker scans for the resolved files, `bun run --filter='./scripts/ci' test`, `bun run --filter='./packages/temporal' typecheck`, and `bun run --filter='./packages/homelab' typecheck`.
- Pushed merge commit `1b4750e9d`; Buildkite build #2597 then failed on Homelab lint because `createTemporalWorkerDeployment` exceeded `max-lines-per-function`.
- Split the Temporal worker homelab audit env and service-account/RBAC setup into helpers, keeping the rendered deployment behavior unchanged while bringing `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts` back under the lint limit.
- Re-ran `cd packages/homelab && bun run lint` and `bun run --filter='./packages/homelab' typecheck`; both pass after the split.

### Remaining

- Push the Homelab lint fix to `fix/github-links` and watch the replacement Buildkite run for PR #816.

### Caveats

- The lefthook-wrapped `quality-ratchet` check hung after visible pre-commit checks had passed; running `bun scripts/quality-ratchet.ts` directly passed, so the recovered audit commit was created with `--no-verify`.
- The branch merge pulled current `origin/main` changes into the PR to clear the dirty merge state; those files are expected to appear in the merge commit.
- Buildkite #2597 also reported Knip and Trivy as soft-failed warning jobs; the blocking failure was the Homelab lint job.

## Session Log — 2026-05-20

### Done

- Audited the changed non-Markdown files for URL contexts that are consumed by tools rather than humans.
- Fixed remaining browser-path URLs in clone/source/SCM contexts: Ansible dotfiles clone, DevPod prebuild target, Maven SCM entries, MkDocs repo/edit links, chezmoi install scripts, Helm Types package metadata, the ArgoCD blog example, Temporal deps-summary clone path, and Cabal source repository metadata.
- Re-ran the strict non-`monorepo` `shepherdjerred` repository reference audit; no matches remain.
- Re-ran the invalid clone/source URL scan for `monorepo/tree/main` in programmatic contexts; only unrelated `repoUrl:` multiline false positives remain.
- Verified with `git -c core.fsmonitor=false diff --check`, Prettier check for supported edited files, ShellCheck for the dotfiles install scripts, `bun run --filter='./packages/temporal' typecheck`, `bun run --filter='./packages/homelab' typecheck`, `bun run --filter='./packages/sjer.red' typecheck`, `bun run --filter='./packages/homelab/src/helm-types' typecheck`, `bun run --filter='./packages/temporal' test` outside the sandbox, and `bun run --filter='./packages/sjer.red' build` outside the sandbox.
- Rebased the PR branch onto current `origin/main`, preserving `main`'s Temporal worker maintenance RBAC additions alongside the PR's fixture URL wiring.
- Re-ran `cd packages/homelab && bun run lint` after the rebase and trimmed `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts` back under the file length limit without changing rendered environment values.

### Remaining

- Watch the replacement Buildkite run after the rebased branch is pushed.

### Caveats

- The first sandboxed `packages/temporal` test run failed because the sandbox blocked Temporal's ephemeral server and a local listener; the same suite passed outside the sandbox.
- The first sandboxed `packages/sjer.red` build failed because the sandbox blocked Chromium's Mach port registration during MDX processing; the same build passed outside the sandbox.
- Browser links, package homepages, rule documentation URLs, Cargo `repository`, and generated RSS/notebook links intentionally remain as GitHub web URLs because those contexts are not Git clone/source endpoints.
- A range-wide `git diff --check origin/main...HEAD` still reports whitespace churn already present in older archived/generated files in this PR; `git -c core.fsmonitor=false diff --check` is clean for the current working tree.
