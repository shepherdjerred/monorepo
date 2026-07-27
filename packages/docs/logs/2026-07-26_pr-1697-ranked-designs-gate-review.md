---
id: log-2026-07-26-pr-1697-ranked-designs-gate-review
type: log
status: complete
board: false
---

# PR #1697 — resolve Codex review finding (ranked-design gate)

## Context

Assigned to get PR #1697 (`feature/scout-gate-ranked-designs`) to green CI.
Only red check was `robot-face-review-gate` with one P2 finding from
`chatgpt-codex-connector`.

## Finding

`packages/scout-for-lol/AGENTS.md` documented `matchToSvg`'s ranked routing
contract as: every ranked solo/flex match with a tracked player renders one
of the two new designs (`ranked-banner` / `ranked-square`); only non-ranked
queues fall back to the legacy report. The PR added
`MatchRenderOptions.enableRankedDesigns` (default `true`), and
`packages/scout-for-lol/packages/backend/src/league/tasks/postmatch/match-report-generator.ts:102`
sets it to `false` in prod — so prod ranked matches now also render the
legacy report until the redesign is promoted. The doc no longer matched
behavior.

## Fix

Added a paragraph to the "Ranked match renderer" section of
`packages/scout-for-lol/AGENTS.md` documenting `enableRankedDesigns`, its
default, and that prod currently opts out. Verified the backend call site
confirms the described behavior before writing the doc update.

## Verification

- `bun run verify -- --affected` (scope: `//`, `scout-for-lol`) — 40/40 tasks
  green (frontend lint has 57 pre-existing `no-code-duplication` warnings,
  0 errors).
- Committed synchronously in foreground (`9b64a60be`), pushed to
  `feature/scout-gate-ranked-designs`.
- Resolved the review thread (`PRRT_kwDOHf4r4c6T5rZ0`) via GraphQL
  `resolveReviewThread`; all review threads on the PR are now resolved.
- No merge conflicts vs `origin/main` (`git merge-tree` diff was purely
  additive/non-overlapping).
- Buildkite build #6455 kicked off for the push; not yet complete at end of
  session (known: `robot-face-review-gate` may still show red pending
  fix #1704 landing, per team-lead's briefing — not a new problem).

## Session Log — 2026-07-26

### Done

- Fixed the one Codex finding on PR #1697 (AGENTS.md ranked-design gate
  documentation) in `packages/scout-for-lol/AGENTS.md`.
- Verified scoped (`--affected`), committed (`9b64a60be`), pushed, and
  resolved the GitHub review thread.
- Confirmed no merge conflicts against `origin/main`.

### Remaining

- Buildkite build #6455 was still running at session end — needs a final
  green confirmation (or investigation if red) once it completes.
- `robot-face-review-gate` may not flip green immediately even at 0
  findings until PR #1704 (gate bug fix) merges — per team-lead's briefing,
  this is expected and not actionable from this PR.

### Caveats

- None beyond the known gate-bug caveat above.
