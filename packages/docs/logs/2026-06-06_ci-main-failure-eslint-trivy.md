# 2026-06-06 — Fix failing CI on `main` (ESLint max-lines + broken Trivy invocation)

## Status

Complete

## Context

CI on `main` was red (Buildkite build
[#3394](https://buildkite.com/sjerred/monorepo/builds/3394), commit
`31f29472e`). Three jobs showed as failed:

| Job                | `soft_failed` | Blocks build? | Cause                                                            |
| ------------------ | ------------- | ------------- | ---------------------------------------------------------------- |
| `:eslint: Lint`    | **false**     | **yes**       | `github-webhook.ts` 517 effective lines > `max-lines` cap of 500 |
| `Large File Check` | true          | no            | Surfacing 8 pre-existing >5 MB files (intended — see below)      |
| `Trivy Scan`       | true          | no            | `exec: "fs": executable file not found` — scan never ran         |

The downstream `waiting_failed` Docker/deploy/CI-Complete steps were pure
cascade from the hard ESLint failure.

Both soft-fail jobs and the hard fail were introduced by the recent quality-step
migration to Dagger (`59684d8ec feat(root): migrate plain quality steps...`).

## Fixes

### 1. ESLint `max-lines` (the build-blocking failure)

`packages/temporal/src/event-bridge/github-webhook.ts` was 546 lines (517 after
`skipComments`). Extracted two cohesive sibling modules — file is now 429 lines:

- `event-bridge/webhook-log.ts` — `COMPONENT` + `jsonLog` (shared by the handler
  and the pipeline starters; own module avoids a circular import).
- `event-bridge/pr-pipeline-starts.ts` — `startPrWorkflows` and its internal
  `startPrReviewPipeline` / `startPrSummaryPipeline` / workflow-id helpers.

Behavior unchanged. The only public exports the rest of the tree uses
(`buildWebhookApp`, `postWebhookStatus`, `startGithubWebhook`) are untouched.

### 2. Trivy invocation bug

`.dagger/src/quality.ts` `trivyScanHelper` ran `.withExec(["fs", ...])`. The
`aquasec/trivy` image's entrypoint is the `trivy` binary, but Dagger's
`withExec` overrides the entrypoint — so `fs` was executed directly and not
found. The security scan had not actually run since the Dagger migration. Fixed
to `.withExec(["trivy", "fs", ...])`, matching the documented
gitleaks/semgrep pattern in the same file. (Soft-fail; may now legitimately
surface real findings instead of an exec error.)

### 3. Large File Check — intentionally left as-is

`largeFileStep` is deliberately `softFail: true` to **surface** 8 pre-existing
files over 5 MB for cleanup, tracked in
`packages/docs/todos/large-file-cleanup.md` (acceptance: shrink/move the files,
then flip back to hard-fail). Adding them to `.largeignore` would defeat that
design, so no change was made here.

## Verification

- `bunx eslint` on the 3 touched temporal files — clean.
- `bun run typecheck` (temporal) — exit 0, 0 errors (after installing `file:`
  sibling deps in the fresh worktree).
- `bun test src/event-bridge/github-webhook.test.ts` — 17 pass / 0 fail.
- `bun test src/workflows/bundle.test.ts` (workflow-bundle smoke) — 1 pass.
- `bun scripts/check-dagger-hygiene.ts` — No violations found.

## Session Log — 2026-06-06

### Done

- Refactored `packages/temporal/src/event-bridge/github-webhook.ts` (546→429
  lines); added `webhook-log.ts` and `pr-pipeline-starts.ts`.
- Fixed `trivyScanHelper` in `.dagger/src/quality.ts` (`fs` → `trivy fs`).
- Verified lint / typecheck / webhook tests / bundle smoke / dagger hygiene.

### Remaining

- Large-file cleanup remains open (`packages/docs/todos/large-file-cleanup.md`).
  Not in scope for this CI fix.
- Trivy will run for real now; if it surfaces HIGH/CRITICAL findings, triage per
  the soft-fail hardening track.

### Caveats

- `.dagger` `tsc --noEmit` reports `Cannot find module '@dagger.io/dagger'`
  across all files in a fresh worktree — the SDK is engine-generated at run time.
  Environmental, not from this change; the dagger-hygiene gate (the real check)
  passes.
