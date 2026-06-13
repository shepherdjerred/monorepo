# Require squash commits on the monorepo

## Status

Complete (pending merge/apply)

## Context

Goal: make `shepherdjerred/monorepo` **require squash merges** — every PR lands as exactly one commit on `main`, with no merge-commit or rebase-merge button in the GitHub UI.

GitHub repo settings are managed by OpenTofu (`packages/homelab/src/tofu/github/`), not the UI — manual GitHub-UI/API edits get reverted on the next `tofu apply`. Before this change the `monorepo` repo had squash **disabled** and merge-commit + rebase enabled (the opposite of the goal), even though the `main` ruleset already enforced `required_linear_history = true`.

## Changes

- **`packages/homelab/src/tofu/github/repos.tf`** — `github_repository.monorepo`: flipped to squash-only
  (`allow_squash_merge = true`, `allow_merge_commit = false`, `allow_rebase_merge = false`) and pinned the
  squashed commit's title/body (`squash_merge_commit_title = "PR_TITLE"`, `squash_merge_commit_message = "COMMIT_MESSAGES"`).
  The `shepherdjerred` profile repo was intentionally left unchanged.
- **`packages/homelab/src/tofu/README.md`** — rewrote the stale "GitHub" section (it wrongly named a `homelab`
  repo and claimed squash-only when squash was actually off) to accurately describe both managed repos, the
  now-true squash-only setting, and the `main` ruleset; added `rulesets.tf` to the `github/` file listing.

No ruleset change was needed — `required_linear_history` is already set and is compatible with squash; GitHub
rulesets can't restrict merge method, so the `github_repository` `allow_*` flags are the only enforcement point.

## Verification

- `tofu -chdir=github fmt -check -diff` → no diff (formatting correct).
- `tofu -chdir=github init -backend=false && tofu -chdir=github validate` → **Success! The configuration is valid.**
  (confirms the provider accepts the new `squash_merge_commit_*` attributes and flag values).
- Full `tofu plan` against live state needs SeaweedFS state creds + `TF_VAR_github_token`; deferred to the PR's
  CI `:terraform: Plan github` step (`tofu-plan-github`), which runs on every non-main branch.

## Session Log — 2026-06-13

### Done

- Edited `packages/homelab/src/tofu/github/repos.tf` (monorepo block → squash-only + pinned squash message).
- Updated `packages/homelab/src/tofu/README.md` (corrected GitHub section + added `rulesets.tf` to listing).
- Validated HCL locally (`fmt` clean, `validate` success).
- Work done on branch `feature/require-squash-commits` in worktree `.claude/worktrees/require-squash-commits`.

### Remaining

- Commit, push, and open the PR (commit scope `tofu`/`homelab`).
- Verify the PR's `tofu-plan-github` CI step shows exactly the three flag flips + two new squash attributes on
  `github_repository.monorepo` and nothing else.
- After merge to `main`, the Buildkite `:terraform: Apply github` step auto-applies. Then confirm in GitHub
  Settings → Pull Requests that only "Allow squash merging" is checked and the squash default is PR title /
  list of commits.

### Caveats

- Apply is automatic on merge to `main` — no manual `tofu apply` needed (the README's "apply is a manual step"
  line is itself stale relative to `scripts/ci/src/steps/tofu.ts`, but that broader doc cleanup was left out of
  scope here).
- The squashed commit subject becomes the **PR title**, so PR titles should be written in conventional-commit
  form (`type(scope): description`) to keep `main`'s history clean — the lefthook commit-msg check only governs
  local commits, not the server-side squash commit.
