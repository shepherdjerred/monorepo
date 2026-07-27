---
id: review-gate-fastforward-reaction-binding
type: todo
status: complete
board: false
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

- [x] Reassess if GitHub exposes a per-ref-update timestamp that covers
      fast-forwards — YES: the **Repository Activity API**
      (`GET /repos/{owner}/{repo}/activity`) reports a `push` /
      `force_push` / `branch_creation` event whose `after` is the head, with a
      real `timestamp`. That is the ref-update instant the residual said was
      unavailable.
- [x] Not needed — the timestamp heuristic is now correct with the real
      ref-update time, so switching to a hypothetical Codex head-bound signal is
      no longer required to close this.
- [x] Not needed — the heuristic is now sound; no shorter-timeout / mandatory
      re-trigger workaround required.

## Comment Log

- 2026-07-26 — Resolved by PR #1704. `resolveHeadPushedAt`
  (`packages/code-review/src/head-pushed-at.ts`, extracted from `github.ts`) now
  takes the LATEST of the Repository Activity API ref-update timestamp
  (`fetchRefUpdateTime` + `pickRefUpdateTime`) and any matching
  `HeadRefForcePushedEvent` — true ref-update instants only, never the commit's
  `pushedDate`/`committedDate`, which can predate the ref move. The
  fast-forward-to-preexisting-commit case is covered:
  the Activity event gives the real instant the ref became the head, so a stale
  👍 left for the previous head predates it and no longer binds. The premise that
  "no API primitive exists" is superseded. Archived to `archive/completed/`.
