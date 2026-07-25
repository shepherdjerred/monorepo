---
id: log-2026-07-16-fix-main-ci-verify-failures
type: log
status: complete
board: false
---

# Fix main CI: four verify failures (build 5611)

## Context

First real run of the new static Buildkite pipeline on main (build
[5611](https://buildkite.com/sjerred/monorepo/builds/5611), commit
`4f08817be`) failed in the `:turborepo: verify` step, blocking every
main-only deploy step. Build 5607 before it failed at pipeline upload
itself (fixed by #1517), so 5611 was the first build to exercise the
full verify surface on main.

## Failures and fixes

| Task                               | Cause                                                                                                                                                             | Fix                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `//#markdownlint`                  | `packages/docs/plans/2026-07-12_turbo-buildout-derisk.md` had MD022/MD032 violations (Session Log appended raw)                                                   | `markdownlint-cli2 --fix`                                                 |
| `//#prettier`                      | Three docs files committed unformatted (same plan file, its sibling replatform plan, and a 07-15 log)                                                             | `prettier --write`                                                        |
| `tasks-for-obsidian#test:contract` | Calendar test hardcoded `due: "2026-07-15"`; the server's default calendar window is `[today, today+30d]`, so the test began failing when the date rolled past    | Use `localTodayYmd()` for the due date                                    |
| `@scout-for-lol/backend#test`      | "account limit is enforced per-server independently" inserts 100 players/accounts one `create` (= one commit/fsync) each; 5475ms vs 5s default timeout on CI pods | Batch both test helpers' inserts into one `$transaction` (~240ms locally) |

## Second round: PR build 5628

The PR's own build then failed on a _different_ scout-backend timeout
(`getActiveCompetitions > excludes ended competitions` — a `beforeEach` of
three `deleteMany` calls took 5.5s). Two different marginal tests in two
consecutive builds means the 5s bun default is simply too tight for
SQLite-backed integration tests on contended CI pods (every statement is
its own commit/fsync). Systemic fix: the backend `test` script now runs
`bun test --timeout 20000`, matching the precedent set by
tasks-for-obsidian's contract suite. The `$transaction` batching from round
one stays — it's a real speedup, just not sufficient on its own.

## Third round: first real main deploy run (builds 5633/5634)

PR #1525 merged (admin bypass — see Notes on the stale ruleset), and the
main-only deploy lane ran for the first time on the new pipeline. Three
latent failures surfaced on build 5633, plus one infra breakage on 5634:

| Step                      | Cause                                                                                                                                                                                                                                          | Fix                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `deploy sites`            | Pods are ephemeral; site buildCmds import workspace library dists (sjer.red → astro-opengraph-images/webring) that only existed in the verify pod                                                                                              | Step builds the graph first (same exclusions as verify), reproduced + validated locally     |
| `npm publish`             | `bun publish` in a workspace resolves `.npmrc` from the workspace ROOT (bun.lock dir) and ignores the package-dir one publish-npm.ts wrote → "missing authentication"                                                                          | Write the `${NPM_TOKEN}` indirection `.npmrc` at the repo root (still removed in `finally`) |
| `cooklang plugin publish` | `DEFAULT_PLUGIN_REPO` pointed at `shepherdjerred/cooklang-rich-preview` (doesn't exist); old Dagger CI passed `--plugin-repo shepherdjerred/cooklang-for-obsidian`                                                                             | Fixed the default repo slug                                                                 |
| verify/docker-e2e on 5634 | The de-mirrored agent-stack config deployed (controller restart via ArgoCD); the pipeline's `buildkite-git-mirrors` volumeMount now references a nonexistent volume → every `*pod`/`*pod_privileged` Job invalid (`stack_error`, never starts) | Dropped the git-mirrors volumeMounts from both pod anchors                                  |

## Notes

- The docs-formatting failures happened because those files were committed
  from sessions that didn't run the formatters; the pre-commit hook formats
  staged files, so these were likely committed with hooks unarmed or bypassed.
- trivy and semgrep also failed on 5611 but are `soft_fail` — intentionally
  ignored per the CI design.
- PR: [#1525](https://github.com/shepherdjerred/monorepo/pull/1525)
