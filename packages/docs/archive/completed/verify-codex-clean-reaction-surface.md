---
id: verify-codex-clean-reaction-surface
type: todo
status: complete
board: false
source_marker: false
---

# Verify where Codex attaches its clean-review 👍 before trusting the blocking gate

## What

The provider-neutral review gate treats a Codex 👍 (`+1`) reaction on the PR
**issue body** as the "reviewed clean, nothing to flag" completion signal for a
no-findings PR (`fetchProviderThumbsUp` in `packages/code-review/src/github.ts`,
consumed by the blocking `review-gate` CI step). This surface — the issue-level
reactions endpoint — is the _documented_ "react with 👍" location, but it has
NOT been confirmed against a live clean Codex review that Codex actually reacts
there (vs. on the `@codex review` issue comment, the PR review, or another
surface).

Raised as a Codex P2 on PR #1657 (`github.ts:359`); the code comment claiming
the surface was "probe-confirmed" was softened to this open caveat. See
[[pr-1657-review-gate-hardening]].

## Why it's open

- Confirming it requires a **live clean PR** — one Codex reviews with zero
  findings so it leaves only the 👍 — which was not available while landing the
  cutover (PR #1657 itself had findings, so Codex left review comments, not a
  clean 👍).
- If the surface is wrong, every clean PR stays `reviewing` until the 20-minute
  gate timeout and then fails, blocking merges on no-findings PRs — a real
  operational risk for the default gate.

## Remaining

- [x] Get a real clean Codex review and record where the 👍 lands — PR #1690
      (2026-07-26) got a live no-findings Codex review; the `+1` landed on the
      **PR issue body**, exactly the surface `fetchProviderThumbsUp` reads.
- [x] Run `probe-review-signal.ts` and confirm `raw.thumbsUpFromProvider` is
      non-null — confirmed on PR #1690 (`createdAt` 2026-07-26T23:53:23Z). The
      event did NOT resolve `reviewed-clean-reaction`, which surfaced a distinct
      bug (below), now fixed.
- [x] Surface is correct, so `fetchProviderThumbsUp` was not changed; the stale
      "NOT yet confirmed" caveat comment in `github.ts` was updated to record the
      live confirmation.
- [x] No flag/longer-timeout needed — the real gap was binding, not the surface,
      and it is fixed directly.

## Comment Log

- 2026-07-26 — Resolved. The reaction **surface** is confirmed correct (PR #1690
  clean review → `+1` on the PR issue body). Confirming it also exposed a
  separate binding bug: `fetchHeadPushedAt` returned null for a normally
  (fast-forward) pushed head — GitHub gives a null `pushedDate` and no
  `HeadRefForcePushedEvent` — so `reactionBoundToHead` marked the at-head 👍
  stale and the gate hung to timeout on every clean PR. Fixed in
  `packages/code-review/src/head-pushed-at.ts` (extracted from `github.ts`) by
  deriving the real ref-update instant from the GitHub Repository Activity API
  (`resolveHeadPushedAt` takes the latest of the Activity
  `push`/`force_push`/`branch_creation` timestamp whose `after` is the head and
  any matching force-push event — never the commit's `pushedDate`/`committedDate`,
  which can predate the ref move), with unit tests. Earlier `committedDate` and
  `pushedDate`-fallback variants were rejected in review (PR #1704): commit/first-
  push time precedes the ref move, so a stale 👍 for a prior head could falsely
  bind — the Activity timestamp avoids that. Archived to
  `archive/completed/` in the fix commit.
