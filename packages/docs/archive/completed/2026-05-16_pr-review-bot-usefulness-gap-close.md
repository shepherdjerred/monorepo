# PR Review Bot Usefulness Gap Close

## Status

**Complete** — all phase code verified shipped to `main`; archived to `archive/completed/` during the 2026-06-06 docs groom (pass 2). NOTE: the PR-review bot was operationally **disabled** on 2026-06-06 (`PR_BOT_ENABLED=false`); re-enabling and the rate-limit fix are tracked in `todos/pr-review-agent-rate-limit-saturation.md`, not here. Original tracking status preserved below.

Partially Complete

## Summary

Recent PR inspection showed the summary pipeline is useful, but the review
pipeline missed or failed to publish the most useful findings that CodeRabbit
surfaced. This plan closes the immediate gap by adding deterministic checks for
the miss classes, making replay exercise the production path, and making empty
reviews honest about coverage.

## Implementation Plan

- Add deterministic pre-consensus findings for container image refs and package
  manifest/runtime dependency issues. These checks should emit normal
  `Finding` objects with verified evidence so they flow through existing
  dedupe and posting.
- Extend verifier targets for `container-image` and `package-manifest`, then
  teach the deps/correctness/convention prompts when to use them.
- Update review comment rendering so it no longer claims a clean review when
  coverage was partial, specialist passes failed, verification was skipped, or
  only baseline stages ran.
- Upgrade replay tooling from the old baseline-only path to the full review
  pipeline stages: bootstrap, deterministic signals, specialists, consensus,
  verification, dedupe, and rendered comment.
- Add regression coverage for the recent misses:
  - Missing GHCR image tags from image-version PRs.
  - React Native/native runtime peer dependencies satisfied only by
    `devDependencies` or `optionalDependencies`.

## Verification

- `cd packages/temporal && bun test src/activities/pr-review src/lib`
- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun run lint`
- Replay recent PRs with read-only tooling once required tokens are available.

## Session Log — 2026-05-17 Initial Implementation

### Done

- Added deterministic PR-review signals for two recent miss classes:
  missing GHCR image tags in `versions.ts` and native runtime peer checks that
  accept `devDependencies` / `optionalDependencies`.
- Added `container-image` and `package-manifest` verifier targets, including
  runtime verifier support and prompt/schema instructions for specialists.
- Wired deterministic signals into the production PR-review workflow before
  consensus so they flow through verification, dedupe, and posting.
- Updated empty review rendering so the bot reports which stages ran instead
  of implying a comprehensive clean review.
- Upgraded `packages/temporal/scripts/replay-pr-review.ts` from baseline-only
  to a read-only current-pipeline replay path with workdir enrichment,
  deterministic-only mode, specialist fan-out, consensus, verification, dedupe,
  and rendered comment output.
- Added/updated regression coverage in `packages/temporal/src/activities/pr-review`
  and `packages/temporal/src/shared/pr-review`.

### Remaining

- Run read-only replay against recent live PRs once `GH_TOKEN` and, for full
  specialist replay, `CLAUDE_CODE_OAUTH_TOKEN` are available in the local
  environment.
- Check production worker logs/metrics for the previously absent review
  comments on recent PRs; this code closes miss classes but does not by itself
  explain missed workflow runs.

### Caveats

- The full `bun run test` initially failed inside the sandbox because the
  Temporal test server could not start there; rerunning outside the sandbox
  passed.
- Root and package dependencies were installed locally to make the Temporal
  package testable in this worktree.
- No commit or PR has been created yet.

## Session Log — 2026-05-17 Commenting Parity

### Done

- Added visible PR-review lifecycle status comments for running, failed, final
  findings/no-findings, and draft-skipped states.
- Added inline GitHub review comment publishing for verified findings, with
  per-finding duplicate markers and diff-anchor validation.
- Added optional finding suggestions and GitHub `suggestion` block rendering
  when the suggested replacement is safely anchored to added diff lines.
- Updated the webhook so draft PRs post a visible skipped status instead of
  disappearing silently.
- Added inline/status posting metrics and focused tests for status rendering,
  inline suggestions, unanchored skips, duplicate skips, inline failure
  resilience, and draft skipped comments.
- Proved the real GitHub mutation path by running production `runPostReview`
  against PR #838 with a controlled synthetic verification finding:
  status comment `4472367801` and inline review comment `3255414329` were both
  created and read back from GitHub; the inline body contained a GitHub
  `suggestion` block.

### Remaining

- Run read-only replay against recent live PRs once `GH_TOKEN` and, for full
  specialist replay, `CLAUDE_CODE_OAUTH_TOKEN` are available locally.
- Confirm production worker logs/metrics after deployment show status comments
  and inline reviews on fresh non-draft PRs.
- Remove or resolve the synthetic verification comments on PR #838 after human
  inspection if they should not remain in the PR discussion.

### Caveats

- `bun run test` still needs to run outside the sandbox because the Temporal
  ephemeral server and OTLP integration test require local process/server
  capabilities blocked by the default sandbox. The escalated rerun passed.
- Full specialist replay was not run from this session because the escalation
  policy blocked sending private PR content to the external model provider from
  pasted credentials; the posting proof used a synthetic finding and GitHub only.
- No commit or PR has been created yet.

## Session Log — 2026-05-17 Useful Finding Proof

### Done

- Replayed recent PRs through the real bootstrap, deterministic signal, and
  consensus stages using GitHub data. PR #826 produced a verified deterministic
  correctness finding for `packages/tasks-for-obsidian/scripts/check-ios-native-deps.ts`.
- Posted that pipeline-generated finding through production `runPostReview`,
  not a synthetic payload. GitHub read-back confirmed status comment
  `4472387694` and inline review comment `3255423457`.
- Tightened the native-peer deterministic signal so it anchors on the actual
  `declaredPackageNames.has(peerName)` line, skips `.test.ts` / `.spec.ts`
  fixtures, and emits a concrete GitHub suggestion replacement.
- Reposted the same pipeline-generated finding with the suggestion-capable
  signal. GitHub read-back confirmed inline review comment `3255426620` at
  `packages/tasks-for-obsidian/scripts/check-ios-native-deps.ts:123` contained
  both the hidden finding marker and a fenced `suggestion` block replacing the
  check with `runtimeDependencyNames.has(peerName)`.
- Added focused regression coverage for the suggestion payload and the test
  fixture false-positive guard.

### Remaining

- Run a full model-backed specialist replay only from an approved environment
  where private PR content may be sent to the configured model provider.
- Create the implementation PR and watch a fresh non-draft PR run end-to-end
  after deployment, so production lifecycle comments can be verified without
  manual invocation.
- Remove or resolve the manual proof comments on PR #826 and PR #838 after
  human inspection if they should not remain in history.

### Caveats

- The real useful-finding proof used GitHub-only deterministic stages because
  model-backed replay with pasted credentials was blocked by escalation policy.
- PR #826 is already merged/closed, but GitHub still accepted both the status
  comment update and inline review comment. A fresh open PR remains the final
  deployment verification target.

## Session Log — 2026-05-17 PR Publication

### Done

- Created branch `codex/pr-review-commenting-parity`.
- Committed the PR-review commenting parity implementation as
  `649e3d61d feat(temporal): post pr review findings inline`.
- Pushed the branch to `origin/codex/pr-review-commenting-parity`.
- Opened draft PR #846:
  <https://github.com/shepherdjerred/monorepo/pull/846>.

### Remaining

- Review CI and address any Buildkite failures or review feedback on PR #846.
- Deploy the Temporal worker after merge and verify a fresh non-draft PR gets
  lifecycle comments plus inline findings without manual invocation.
- Remove or resolve manual proof comments on PR #826 and PR #838 if they should
  not remain in the PR history.

### Caveats

- The local `gh auth status` token is invalid, so the PR was created with the
  GitHub connector and the branch was pushed using an explicit HTTPS token.
- The first HTTPS push attempt used a bearer header and failed; the subsequent
  GitHub Basic token push succeeded.
