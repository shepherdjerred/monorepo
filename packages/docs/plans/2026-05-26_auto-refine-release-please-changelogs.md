# Plan: Auto-refine release-please CHANGELOGs in CI (Dagger step)

## Status

In Progress — code shipped on branch `feat/refine-release-notes-in-ci`. Awaiting (1) PR merge and (2) addition of `CLAUDE_CODE_OAUTH_TOKEN` to the 1Password item backing the `buildkite-ci-secrets` k8s secret (vault `v64ocnykdqju4ui6j6pua56xw4`, item `rzk3lawpk4yspyyu5rxlz44ssi`). Without the secret field, the release-please CI step will fail when it tries to read the env var.

## Context

`release-please` auto-generates per-package CHANGELOGs for the three published packages in this monorepo (`astro-opengraph-images`, `webring`, `helm-types`). Because most commits land with `feat(root): ...` / `fix(root): ...` scopes, the generated CHANGELOGs sweep in commits that did not touch the package being released (e.g. "ship 2026-05-09 batch — homelab audit, Renovate coverage, doc discipline, trmnl-dashboard" appearing under `astro-opengraph-images`).

Today the user fixes this by hand: read the actual diff per package since the last tag, strip monorepo-internal noise (devDeps, lockfile churn, line-ending normalization, test-only changes), and rewrite the new CHANGELOG sections to show only what library consumers see when they upgrade. The bot regenerates the PR every time a commit lands on `main`, wiping the hand-edits — so this often has to be redone before merging.

This plan adds a follow-on step inside the existing release-please CI flow that runs a Claude agent to refine the just-generated CHANGELOGs and push a cleanup commit to the release-please PR branch. A human still reviews and merges.

## Why CI instead of Temporal

- Release-please already runs in CI on every main push (`scripts/ci/src/steps/release.ts` → `dagger call release-please`). The cleanup is the natural next step in the same pipeline.
- The GitHub App token is already minted in the same container (`mintGithubAppTokenAndSetupGitAuth` in `.dagger/src/release.ts`).
- No webhook routing, no loop prevention needed — the cleanup runs once per main push, immediately after the PR is regenerated, so the "the bot just wiped my edits" race goes away by construction.
- No new Temporal workflows, no schema changes, no `mode` enum expansion.
- Visible alongside release-please in the same Buildkite build — easy log discovery.

## Approach

Extend the existing `releasePleaseHelper` in `.dagger/src/release.ts` to run a third command after `release-please release-pr` and `release-please github-release`: invoke `claude -p` (already a known pattern from the Temporal agent-task activity) with a fixed refinement prompt. The agent uses `gh` CLI and `git` (both already available in the container via `withAptPackages` + the bun image) plus the already-set `$GH_TOKEN` to find the open release PR, refine the CHANGELOGs, and push a commit to its branch.

If there's no open release-please PR or nothing to refine, the agent does nothing and exits cleanly.

### Files to modify

| File                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dagger/src/release.ts`                         | (1) Add `claude` CLI install to the container (alongside `bun add -g release-please`). (2) Extend `releasePleaseHelper` to accept a new `claudeOauthToken: Secret` parameter. (3) Append a third shell command after the two `release-please` invocations: `claude -p --output-format json "$(cat /workspace/.dagger/prompts/refine-release-please.md)"`. (4) Mount the prompt into the container.                                                                                                                                                                                                                                                                                                                          |
| `.dagger/prompts/refine-release-please.md` (new) | The agent prompt as a separate file for readability and code review. Embeds the rules from `~/.claude/projects/-Users-jerred/memory/feedback_release_please_changelogs.md` (library-consumer view only; strip devDeps/overrides/lockfiles/line-endings/tests/examples; keep runtime deps, source/behavior changes, published metadata, README). Instructs the agent to: locate the open `chore: release main` PR via `gh pr list`, check out its branch, diff each bumped package vs its last tag, rewrite the new CHANGELOG sections, commit with `chore(root): refine release notes ...` (commit-msg hook requires the conventional scope), push to the same branch, and update the PR body via `gh pr edit --body-file`. |
| `scripts/ci/src/steps/release.ts`                | Add the Claude OAuth secret to the dagger call arguments (mirror `GITHUB_APP_SECRET_ARGS`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `scripts/ci/src/lib/buildkite.ts` _(if needed)_  | Add `CLAUDE_OAUTH_SECRET_ARG` constant analogous to `GITHUB_APP_SECRET_ARGS` so the secret is passed from Buildkite agent env into the Dagger run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Secrets / configuration

- **`CLAUDE_CODE_OAUTH_TOKEN`** (or API key) — already used by the Temporal worker (`packages/temporal/src/activities/agent-task.ts`); reuse the same 1Password-backed secret in the Buildkite agent env. No new secret to create.
- Existing `GITHUB_APP_*` secrets are already wired and minted into `$GH_TOKEN` by `mintGithubAppTokenAndSetupGitAuth`. The agent inherits them.

### Idempotency & failure handling

- **Idempotent by construction**: the agent's task is "refine if needed." If the CHANGELOG already matches the library-consumer view (e.g. no new commits since last refinement), the agent diffs find nothing material and it makes no commit.
- **Failure mode**: if the agent errors (e.g. Claude API down, gh auth flakes), the Dagger step exits non-zero. Decide between:
  - **Fail the CI step** (red Buildkite build, alerts you) — recommended; a release that can't be refined shouldn't merge silently with the noisy notes.
  - **Soft-fail** (`buildkite-agent step soft-fail`) — refine is best-effort, release-please-action portion already succeeded.
  - Default to fail-loud; revisit if it turns out to be too noisy.
- **Timeout**: bump the existing 10-minute step timeout to ~20 minutes to absorb a ~5-10 minute claude run. Confirm during implementation.

### What the agent will be told (prompt outline)

> You are in a CI container right after `release-please` created or updated PR #N on branch `release-please--branches--main` for shepherdjerred/monorepo. Repository is checked out at `/workspace`. `gh` and `git` are authenticated via `$GH_TOKEN`.
>
> 1. `gh pr list --base main --label "autorelease: pending" --json number,headRefName,body` — find the open release-please PR. If none, exit 0 with `<!-- claude-result -->{"status":"no-open-release-pr"}<!-- /claude-result -->`.
> 2. `git fetch && git checkout <headRefName>`.
> 3. Read `.release-please-manifest.json` (or parse the PR body) to identify which packages were bumped and to what versions.
> 4. For each bumped package: `git diff <last-tag>..origin/main -- <package-path>`.
> 5. **Strip monorepo-internal items**: devDep bumps (eslint, jiti, typescript), `overrides` (npm consumers ignore these), mise/bun tooling pins, line-ending normalization, test-only changes, example reformatting, lockfile churn. **Keep**: runtime-dep changes in `dependencies`/`peerDependencies`, source/behavior changes (verify with `git diff`), README and `package.json` metadata that ships in the npm tarball.
> 6. Rewrite the new CHANGELOG section in each package's `CHANGELOG.md`.
> 7. If any CHANGELOG changed: commit (`chore(root): refine release notes for {date}`), push to the release branch, update the PR body via `gh pr edit --body-file`.
> 8. Emit `<!-- claude-result -->{"packagesRefined":[...], "commitSha":"..."}<!-- /claude-result -->` and exit 0. On any failure, exit non-zero with a clear stderr message.

The prompt also references the existing repo conventions: commit-msg hook requires `type(scope):` format; mise must be trusted in the container.

## Verification

End-to-end test plan:

1. **Local Dagger run against a fork or test branch** — `dagger call release-please --source . --dryrun=false --claude-oauth-token=op://...` against a checkout that has uncommitted "release-worthy" changes. Confirm the agent finds the test PR, refines, and pushes.
2. **CI dry run** — temporarily switch `releasePleaseStep` to a non-main branch condition (or a manual buildkite trigger) and exercise it end-to-end on a draft release PR.
3. **Real release** — wait for the next release-please regeneration on `main`. Confirm refinement happens automatically within the same Buildkite build, the CHANGELOGs match library-consumer scope, and the PR body matches.
4. **Idempotency check** — push a noop commit to `main`. release-please regenerates → agent runs → refine → push. Then push another noop commit. Agent runs again; should detect no material diffs and exit cleanly (zero CHANGELOG changes, no new commit on PR branch).
5. **Failure mode check** — temporarily invalidate `CLAUDE_CODE_OAUTH_TOKEN`; confirm the CI step fails loudly with a clear error rather than silently passing.

## Rollback

Revert the changes to `.dagger/src/release.ts`, `scripts/ci/src/steps/release.ts`, and remove `.dagger/prompts/refine-release-please.md`. release-please continues to operate normally without the cleanup.

## Open question resolved during implementation

- **Refinement order**: placed between `release-please release-pr` and `release-please github-release`. `github-release` is a no-op on an open PR, so the order doesn't matter functionally; keeping it last preserves intent ("create/update PR → refine → publish on merge").

## Session Log — 2026-05-26

### Done

- New agent prompt at `.dagger/prompts/refine-release-please.md` — describes the library-consumer filter, the 9-step procedure (locate PR, fresh git clone, diff vs last tag, rewrite CHANGELOG sections, commit, push, update PR body), and hard rules (no `git add -A`, no `x-access-token` URLs).
- `.dagger/src/release.ts` `releasePleaseHelper` extended:
  - Installs `gh`, `claude` (pinned via `CLAUDE_CODE_VERSION`), and `ca-certificates`/`curl` in the bun image alongside `git` and `release-please`.
  - New `claudeOauthToken: Secret` parameter; mounted as `CLAUDE_CODE_OAUTH_TOKEN` env var.
  - `mintGithubAppTokenAndSetupGitAuth` now uses `withAskpass: true` (was `false`) so the agent's `git push` works.
  - Sequence: `release-pr` → `claude -p` (refine) → `github-release`.
- `.dagger/src/index.ts` `@func releasePlease` wrapper updated to accept and forward the new secret.
- `scripts/ci/src/lib/buildkite.ts` adds `CLAUDE_OAUTH_SECRET_ARG` constant (mirrors `GITHUB_APP_SECRET_ARGS`).
- `scripts/ci/src/steps/release.ts` passes the new secret arg and bumps step timeout 10 → 20 min.
- Local verification: `bunx tsc --noEmit` clean in both `.dagger/` and `scripts/ci/`. `dagger call release-please --help` shows `--claude-oauth-token` required. `bun scripts/check-dagger-hygiene.ts` reports no violations. Step-construction smoke test confirms the generated dagger CLI command is correct.

### Remaining

- **User must add `CLAUDE_CODE_OAUTH_TOKEN` to the 1Password item `rzk3lawpk4yspyyu5rxlz44ssi` in vault `v64ocnykdqju4ui6j6pua56xw4`** so the `buildkite-ci-secrets` k8s Secret picks it up via the existing `OnePasswordItem` sync. Without this, the first run after merge will fail with a missing-env error.
- End-to-end validation has to happen on the next real release-please run on `main`. We chose not to test on a draft branch because (a) the step is gated to `MAIN_ONLY`, and (b) we don't want to accidentally push refinements to an unintended release PR.

### Caveats

- Pipeline order is `release-pr → refine → github-release`. If the refine step errors, `github-release` won't run that build — but since `github-release` only acts when a release PR has been merged (not while one is open), this typically doesn't matter for the current run; the next merge to `main` will run it.
- 20-min step timeout assumes a refine subprocess of ≤10 min on Opus. If consistently slower, bump again or downgrade model.
- The agent fresh-clones the repo into `/tmp/monorepo` (depth 500) rather than using `/workspace`, because `SOURCE_EXCLUDES` strips `.git`. Network egress cost: ~50–200 MB per run.
- `--dangerously-skip-permissions` is set on the claude invocation, which is acceptable here because the prompt is fixed and code-reviewed (no user input gets injected). Re-evaluate if the prompt ever becomes dynamic.
