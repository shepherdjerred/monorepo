---
id: log-2026-07-29-scout-review-evals-freshness-rating
type: log
status: complete
board: false
---

# Scout review eval freshness rating invalidation

## Session Log — 2026-07-29

### Done

- Updated `packages/scout-for-lol/packages/evals/src/server/store.ts` so recording
  a generation transactionally invalidates the affected dataset/style freshness
  rating.
- Added regression coverage in
  `packages/scout-for-lol/packages/evals/src/server/store.test.ts`.
- Verified PR #1777 with the focused eval tests, typecheck, changed-file ESLint,
  and changed-file Prettier checks.

### Remaining

- Address the three remaining P2 review findings on PR #1777.
- Let Buildkite and a current-head Codex review validate the published commit.

### Caveats

- The package-wide lint command currently rejects
  `data/create-calibration-20-spec.ts` because it is outside the TypeScript
  project service; ESLint passes on both files changed in this fix.
- Two earlier-session documentation files remain dirty and were preserved
  byte-for-byte.
