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
- Changed the Beta corpus snapshot identity to `(server_id, puuid)`, required
  materialization specs to identify the Beta `targetPlayerId`, and scoped
  tracked-player resolution to that player's guild.
- Added cross-guild PUUID regression coverage and included `targetPlayerId` in
  candidate discovery output.
- Replaced the eval package's `bunx` lint and typecheck scripts with
  `bun x --no-install`, matching the Bun-only Buildkite runtime.
- Restacked PR #1777 onto current `main` with git-spice and resolved the
  Playwright lane conflict by preserving main's pinned CI image while retaining
  the eval package's install, Turbo filters, and change-selection inputs.
- Verified PR #1777 with the focused eval tests, typecheck, changed-file ESLint,
  changed-file Prettier checks, Buildkite pipeline validator, lane-coverage
  tests, and an independent merge-tree check.

### Remaining

- Address the remaining P2 review findings on PR #1777.
- Let Buildkite and a current-head Codex review validate the published
  restacked head.

### Caveats

- Package-wide tracked-source ESLint passes. The ignored, local-only
  `data/create-calibration-20-spec.ts` remains outside the committed TypeScript
  project and requires `--ignore-pattern data` when present.
- Two earlier-session documentation files remain dirty and were preserved
  byte-for-byte.
