---
id: review-gate-fastforward-reaction-binding
type: todo
status: planned
board: true
verification: human
disposition: active
origin: packages/docs/logs/2026-07-25_pr-1657-review-gate-hardening.md
source_marker: false
---

# Residual: a clean 👍 can bind to a fast-forwarded pre-existing head

## What

The review gate's clean-review signal for Codex is a bare 👍 reaction that
carries no commit SHA, so `reactionBoundToHead`
(`packages/code-review/src/github.ts`) binds it to the head by timestamp:
`fetchHeadPushedAt` returns the LATEST of the commit's `pushedDate` and any
`HeadRefForcePushedEvent` whose `afterCommit` is the head, and the 👍 must be
created at/after that time.

This covers ordinary append pushes (accurate `pushedDate`) and force-pushes
(the timeline event). It does NOT cover a plain **fast-forward of the PR ref to
a commit that already existed** in the repo (e.g. promoting a commit previously
pushed on another stacked branch): there is no `HeadRefForcePushedEvent`, and
the commit's `pushedDate` predates the ref update. A stale 👍 left on the
previous head after that old `pushedDate` could then bind to the new head and
satisfy the blocking gate before Codex re-reviews it.

Raised as a Codex P1 on PR #1657 (`github.ts:343`); **accepted as a documented
residual** by the repo owner rather than fixed, because there is no clean fix —
see below and [[pr-1657-review-gate-hardening]]. Related fragility of the same
bare-👍 signal: [[verify-codex-clean-reaction-surface]].

## Why it's open

- **No API primitive.** GitHub exposes no reliable "when did the PR head ref
  become commit X" timestamp for a fast-forward-to-preexisting-commit, and that
  case is indistinguishable from a legitimately-old head via the available API.
- **The alternatives are worse.** Binding _only_ via force-push events (dropping
  `pushedDate`) would leave every ordinary clean PR's 👍 unbindable → the gate
  would hang to its 20-minute timeout on normal no-findings PRs. A larger
  redesign of the clean path (require a fresh review object / a different signal)
  is out of proportion for the Greptile→Codex cutover.
- **The residual is bounded and mitigated.** Exploiting it requires
  fast-forward-promoting an old commit AND a stale 👍 whose timing lands in the
  window before Codex auto-re-reviews on the next push (Codex re-reviews on
  push, shrinking the window); it is a contrived scenario on a repo where the
  author controls the branch.

## Remaining

- [ ] Reassess if GitHub ever exposes a per-ref-update timestamp (PR timeline
      `PullRequestCommit` / a synchronize-event time) that covers fast-forwards.
- [ ] If Codex ever emits a head-bound clean signal (a review object or a
      status/check on a clean PR), switch the clean path to it and drop the
      timestamp heuristic entirely.
- [ ] Re-evaluate whether a shorter default `REVIEW_WAIT_TIMEOUT_SECONDS` plus a
      required `@codex review` re-trigger is preferable to the heuristic for the
      default blocking gate.
