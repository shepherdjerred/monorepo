---
id: verify-codex-clean-reaction-surface
type: todo
status: planned
board: true
verification: human
disposition: active
origin: packages/docs/logs/2026-07-25_pr-1657-review-gate-hardening.md
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

- [ ] Get a real clean Codex review on a throwaway/no-findings PR (or identify a
      past one) and record where the 👍 actually lands.
- [ ] Run `GH_TOKEN=$(gh auth token) bun scripts/probe-review-signal.ts <pr>`
      against that PR and confirm `raw.thumbsUpFromProvider` is non-null and the
      event resolves `review_state: "reviewed-clean-reaction"`.
- [ ] If the 👍 is on a different surface, extend `fetchProviderThumbsUp` to read
      that surface (e.g. the `@codex review` comment reactions) and add a
      fixture; otherwise remove the caveat comment in `github.ts`.
- [ ] Until confirmed, consider whether the clean-reaction path should be gated
      behind a flag or whether a longer default timeout is warranted.
