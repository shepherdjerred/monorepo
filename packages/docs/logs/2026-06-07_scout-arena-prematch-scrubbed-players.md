# Scout Arena Pre-match — Missing Tracked Player (investigation + doc)

## Status

Complete

## Summary

Investigated a report that Arena **post-match** shows all tracked players but the
**pre-match** image is missing one. Root-caused it to Riot Spectator-V5 privacy scrubbing
(null `puuid` + champion-name placeholder `riotId` → no usable identity). Concluded there is
no fix for rendering the scrubbed player's real card pre-match. Decision: accept the data loss
and document the limitation. No behavior change.

Full analysis and decision: `packages/docs/decisions/2026-06-07_scout-arena-prematch-scrubbed-players.md`.

## Session Log — 2026-06-07

### Done

- Root-caused via the captured payload `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/__tests__/testdata/spectator-ranked-flex.json` (scrubbed participant: `puuid: null`, `riotId: "Nami"` = champion name).
- Added the decision record `packages/docs/decisions/2026-06-07_scout-arena-prematch-scrubbed-players.md` and linked it from `packages/docs/index.md`.
- Added explanatory code comments (pointing to the decision doc) at the three match sites:
  - `packages/scout-for-lol/packages/data/src/league/raw-current-game-info.schema.ts` (`puuid` + `riotId` fields)
  - `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/loading-screen-builder.ts` (`isTrackedPlayer`)
  - `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/active-game-detection.ts` (tracked-player filter)

### Remaining

- None. Documentation-only; no code fix is possible for the image.

### Caveats

- `typecheck`/`eslint` were not run: this fresh worktree has no deps installed (`scripts/setup.ts` not run). Changes are comment-only TS + Markdown with no logic/type-surface change, so they cannot newly fail those checks; pre-commit hooks will format on commit.
- Deliberately declined mitigations (notification text via per-puuid `getActiveGame`; generic "hidden player" placeholder card) are recorded in the decision doc if the limitation ever needs revisiting.
