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
- Added the parent `scout-for-lol` workspace to both Playwright lanes' filtered
  installs so the isolated linker includes the workspace that owns the shared
  Scout ESLint config and its direct dependencies.
- Reproduced Buildkite #7226's missing `@shepherdjerred/eslint-config` failure
  from a clean archive with the old filtered closure, then verified the corrected
  closure with a fresh install and Turbo-driven eval lint.
- Made S3 materialization reject independently valid raw match and timeline
  documents when their metadata match IDs differ, before constructing a source
  pair, with regression coverage through the S3 fetch boundary.
- Replaced the final-review-only prompt fields with a strict rendered-prompt
  artifact that freezes match-summary, ordered timeline chunk, timeline
  aggregate, single-timeline, and final-review requests; finalized SQLite
  round-trip and multi-chunk validation tests cover persistence and ordering.
- Made file-backed eval database startup recursively create missing parent
  directories before opening SQLite, with focused coverage for fresh nested
  paths and unchanged in-memory behavior.
- Bound freshness rating mutations to a typed revision of the ordered latest
  generation IDs displayed to the reviewer, rejecting stale submissions
  transactionally when any generation changes.
- Added strict per-generation rendered-prompt persistence and query parsing so
  materialized baselines and divergent reruns retain their own exact inputs;
  the case UI now displays prompts from the generation beside its output.
- Made dataset creation, every materialized case, and every baseline generation
  one atomic SQLite operation, with rollback and successful-batch coverage.
- Added a live read-only overall score to the human scorecard, calculated as the
  displayed two-decimal simple mean of the three rubric dimensions and restored
  from persisted ratings on revisit.
- Made app-created drafts actionable materialization targets by accepting their
  displayed `datasetId`, validating draft status before model calls, and writing
  the generated batch into that same dataset atomically.
- Rejected negative, fractional, and out-of-range caller-selected player indexes
  before provider checks or backend review-generation work, replacing the
  missing-player skip with a fail-fast contract error.
- Verified PR #1777 with the focused eval tests, typecheck, changed-file ESLint,
  changed-file Prettier checks, Buildkite pipeline validator, lane-coverage
  tests, and an independent merge-tree check.

### Remaining

- Address the other remaining P2 review findings on PR #1777.
- Let replacement Buildkite CI and a current-head Codex review validate the
  published CI-remediation head.

### Caveats

- Focused ESLint passes for every changed TypeScript file. The ignored,
  local-only
  `data/create-calibration-20-spec.ts` remains outside the committed TypeScript
  project and requires `--ignore-pattern data` when present.
- The eval artifact remains schema version 1 because its initial format has not
  shipped and SQLite stores it as validated JSON. Local draft databases created
  from earlier PR heads require rematerialization so strict reads contain the
  newly required rendered prompts.
- The generation-prompt migration intentionally does not synthesize prompt
  evidence for existing generation rows. Earlier local databases containing
  generations must be rematerialized rather than accepting an invented
  fallback.
- Two earlier-session documentation files remain dirty and were preserved
  byte-for-byte.
