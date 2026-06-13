---
id: enforce-commit-scopes-in-ci
status: deferred
origin: packages/docs/logs/2026-06-13_commitlint-scopes.md
source_marker: false
---

# Enforce commit type/scope allowlist in CI (PR titles), not just locally

## What

Commit type/scope validation lives entirely in the local `commit-msg` hook
(`scripts/validate-commit-msg.ts`, wired via `lefthook.yml`). That hook only
runs on commits authored locally. Two high-volume paths bypass it completely:

- **Renovate** commits are created via the GitHub API and never run local
  git hooks (this is why `chore(deps):` commits exist despite `deps` not
  having been in the allowlist until 2026-06-13).
- **GitHub squash-merges** build the merge-commit subject from the PR title
  on the server side, so the scope list is never checked against merged
  history. This is how out-of-allowlist scopes like `cooklang` and `ci`
  leaked into `main`.

Net effect: the allowlist is advisory for the commits that actually shape the
default branch.

## Why deferred

The 2026-06-13 change (add `deps`/`ci`/`cooklang` scopes, clean up the `as`
cast) was scoped to the allowlist itself. Real enforcement is a separate,
larger change (a new CI step / ruleset) and was explicitly deferred by the
owner for a follow-up.

## Proposed fix (smallest first)

1. A Buildkite step that runs `validate-commit-msg.ts` against the **PR
   title** on `pull_request` builds (Buildkite exposes the PR title via env).
   Reuse the existing validator — factor the validation core out of `main()`
   so a thin wrapper can pass the PR title string instead of a file path.
2. Optionally also validate every commit subject in the PR range.
3. Alternative/addition: a GitHub ruleset or lightweight Action doing the same
   check, so the signal shows up directly on the PR.

## Acceptance

- A PR whose title has a bogus scope/type fails a required check.
- Renovate PRs (`chore(deps):`) still pass.
- The check reuses `scripts/validate-commit-msg.ts` logic (no duplicated
  type/scope lists).
