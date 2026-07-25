---
id: babysit-greptile-outside-diff
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-06-27_pr-babysit-bot.md
---

# Babysitter DoD: cover Greptile "comments outside of diff"

The PR babysitter's review-thread gate (`evaluateBabysitDoD` →
`getReviewThreads` in `packages/temporal/src/activities/pr-babysit/github.ts`)
currently reads only **diff-anchored review threads** (GraphQL
`pullRequest.reviewThreads`), which is the primary, resolvable gate.

Greptile also posts **"comments outside of diff"** — un-anchored findings that
arrive as the pull-request review body or as plain issue comments, which do not
appear in `reviewThreads` and are not individually resolvable. The manual
babysitter spec explicitly treats unresolved P3+ "comments outside of diff" as
blocking, so the automated DoD under-blocks until these are covered.

## Remaining

- [ ] Also fetch the latest Greptile `pullRequestReview` bodies and/or issue
      comments by `greptile-apps[bot]`, parse P-levels with the existing
      `parseReviewSeverity`, and fold any unresolved P3+ into the review verdict.
- [ ] Decide a "resolved" signal for un-anchored comments (Greptile re-reviews on a
      new push and supersedes; or treat the latest review as authoritative).
- [ ] Add fixtures + unit tests alongside `dod.test.ts`.

Until then, the verdict's `reviews.advisory` surfaces non-blocking unresolved
threads so a human still sees them.
