---
id: reference-completed-2026-05-17-github-app-pr-automation
type: reference
status: complete
board: false
---

# GitHub App PR Automation

## Summary

Move automated PR and review actions from static GitHub user tokens to short-lived GitHub App installation tokens so visible GitHub actions are attributed to the app bot account.

## Plan

- Add a Bun-native GitHub App installation token helper that reads `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`, signs an app JWT, exchanges it for an installation access token, validates the response, and prints only the token when run as a CLI.
- Use the app token for PR/review/comment surfaces in Buildkite scripts, Dagger commit-back/release-please PR operations, and Temporal PR review/summary/generated-PR activities.
- Keep `GH_TOKEN` for non-PR GitHub operations such as registry/package publishing until those surfaces are separately verified.
- Wire the new secret fields into the Temporal worker environment and document them in `packages/temporal/AGENTS.md`.
- Verify with focused helper tests, Temporal tests, Dagger/script generation checks, and shell syntax checks.

## Acceptance Criteria

- PR creation, PR review, PR summary/comment posting, and generated PR pushes use installation tokens derived from the GitHub App credentials.
- Missing app credentials fail fast with clear errors on PR/review automation paths.
- Existing generated commit author metadata remains explicit.
- `GH_TOKEN` remains available where existing publishing or infrastructure code still requires it.

## Session Log — 2026-05-17

### Done

- Added `packages/temporal/src/lib/github-app-token.ts`, a Bun/WebCrypto GitHub App installation-token helper with CLI output and strict token/expiry validation.
- Added `packages/temporal/src/lib/github-app-token.test.ts` covering missing env, escaped PEM newlines, JWT shape, installation-token request shape, invalid responses, and expired tokens.
- Updated Buildkite review/README automation to mint `GH_TOKEN` from GitHub App credentials before invoking Claude, `gh pr review`, `gh pr create`, or git push.
- Updated Dagger commit-back/release-please PR automation to use GitHub App installation tokens for git push and `gh`/release-please PR operations while leaving existing package/registry publishing `GH_TOKEN` paths intact.
- Updated Temporal PR review/bootstrap/post/summary/dismissal ingest plus Data Dragon and Scout generated-PR flows to use GitHub App installation tokens for Octokit, git push, and `gh pr create`.
- Wired `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY` into the Temporal worker environment and documented the new auth split.
- Updated release-push inventory docs to mark automated Git pushes as GitHub App-backed.
- Published draft PR `#844` from branch `codex/github-app-pr-automation`.

### Remaining

- Run the manual live dry run once the Kubernetes 1Password operator has synced the new fields into the runtime secrets: mint a token, check `gh api user`/repo access, then create or comment on a disposable draft PR and verify the actor is `app-slug[bot]`.

### Caveats

- Full Temporal test suite was attempted but the local sandbox blocked Temporal's ephemeral test server and `Bun.serve` on port `0`; focused non-server Temporal tests passed.
- `dagger develop` / `dagger functions` required escalated access to the local container runtime and still emitted the repo-format warning for this worktree, but the module loaded successfully.

## Session Log - 2026-05-17 Secret Provisioning

### Done

- Confirmed the GitHub App installation id from the provided installation URL as `133220859`.
- Found and validated the private key file at `/Users/jerred/Downloads/derrej.2026-05-17.private-key.pem` without printing its contents.
- Added `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY` to the `Buildkite CI Secrets` 1Password item backing the `buildkite-ci-secrets` Kubernetes secret.
- Added the same three fields to the `temporal-worker-secrets` 1Password item backing the Temporal worker secret.
- Verified both items contain the new fields with expected non-secret lengths only: app id length 7, installation id length 9, private key length 1679.

### Remaining

- Wait for the Kubernetes 1Password operator to sync the updated item fields into cluster secrets before relying on the deployed automation.
- Run the manual live dry run after sync: mint an app installation token, check `gh api user`/repo access, then create or comment on a disposable draft PR and verify the actor is the GitHub App bot.

### Caveats

- 1Password CLI required an escalated command so it could access the desktop app integration outside the Codex sandbox.
- The private key value was handled via a temporary 1Password item template and removed after the edit command completed.

## Session Log - 2026-05-17 PR Conflict Follow-Up

### Done

- Rebasing PR branch `codex/github-app-pr-automation` onto current `origin/main` resolved the GitHub conflict reports in `.dagger/src/index.ts` and `packages/temporal/src/activities/data-dragon.ts`.
- Preserved main's Cooklang manifest validation and Data Dragon helper-module refactor while keeping GitHub App installation-token usage for Data Dragon git push and `gh` PR operations.
- Moved Data Dragon's missing GitHub App credential failure classification into the extracted `data-dragon-util.ts` helper.

### Remaining

- Push the rebased branch and let Buildkite rerun against the conflict-free head commit.
- Monitor Buildkite PR build status until `ci-complete` reports a final result.

### Caveats

- A direct `.dagger` `tsc --noEmit` command is not a valid project check in this checkout because the package lacks Node test globals in that standalone TypeScript invocation. The Dagger module load check is the relevant validation path for this change.

## Session Log - 2026-05-17 PR Conflict and Prettier Follow-Up

### Done

- Rebasing PR branch `codex/github-app-pr-automation` onto current `origin/main` resolved GitHub conflict reports in `packages/temporal/scripts/replay-pr-review.ts` and `packages/temporal/src/activities/pr-review/post.ts`.
- Preserved main's full PR-review replay/status-comment implementation while keeping GitHub App installation-token auth for replay, review posting, and review status posting.
- Ran Prettier on `.dagger/src/index.ts` and `.dagger/src/release.ts`, fixing Buildkite #2569 `art-prettier`.

### Remaining

- Push the rebased branch and watch the next Buildkite build for a final result.

### Caveats

- Buildkite #2569 was for prior head `5ca613023a` and should be superseded by the next build after force-push.

## Session Log - 2026-05-17 Temporal Lint Follow-Up

### Done

- Removed stale conflict-resolution imports from `packages/temporal/src/activities/pr-review/post.ts` that caused Buildkite #2583 Temporal ESLint and typecheck failures.
- Re-ran Temporal typecheck, Temporal ESLint, and Prettier locally after the fix.

### Remaining

- Push the amended branch and watch the next Buildkite build for a final result.

### Caveats

- Buildkite #2583 still contains the failed Temporal jobs from the previous pushed head; the next push should supersede it.
