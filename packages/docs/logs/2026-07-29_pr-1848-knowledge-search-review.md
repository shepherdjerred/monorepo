---
id: log-2026-07-29-pr-1848-knowledge-search-review
type: log
status: complete
board: false
---

# PR #1848 knowledge search review

## Scope

Address the current unresolved review findings in the decision-policy layer's
knowledge passage ranking and excerpt selection without changing the stack's
semantic-control boundaries.

## Starting Evidence

- PR head: `39766ac936a5df3944ae57d6414bf735b6e639f4`
- Actual stacked base:
  `feature/pokemon-semantic-gameplay@35b8ddb2c5ed5444ea278688e452db3d02928170`
- Independent `git merge-tree --write-tree --quiet` against the actual base
  completed successfully.
- Buildkite build `7223` matched the exact PR head and failed in
  `//#script-coverage`; the failed coverage belongs to the downstack WASM build
  script, while downstream broken jobs are dependency fallout.
- Four unresolved, non-outdated findings target one ranking primitive:
  whole-term matching, closest repeated-term windows, coverage-first ranking,
  and excerpt anchoring at the decisive window.

## Verification

- `bun test src/goal/knowledge.test.ts`: 14 passed, 0 failed.
- `bunx turbo run test --filter=@discord-plays-pokemon/backend`: 353 passed,
  0 failed.
- `bunx turbo run typecheck --filter=@discord-plays-pokemon/backend`: passed.
- `bunx turbo run lint --filter=@discord-plays-pokemon/backend`: passed.

## Session Log — 2026-07-29

### Done

- Replaced first-substring passage scoring in
  `packages/discord-plays-pokemon/packages/backend/src/goal/knowledge.ts` with
  one whole-token sliding window that preserves compact letter-number tokens,
  maximizes coverage, minimizes repeated-term span, and returns the original
  excerpt position.
- Made each additional covered query term worth more than the maximum
  proximity bonus.
- Added focused and committed-corpus regressions in
  `packages/discord-plays-pokemon/packages/backend/src/goal/knowledge.test.ts`
  for `cut` versus `shortcut`, coverage-first ranking, and the long repeated
  Latios passage.
- Completed focused backend test, typecheck, and lint verification for PR
  `#1848`.

### Remaining

- Confirm the replacement PR head passes its new Buildkite build and hosted
  review.

### Caveats

- Buildkite build `7223` failed the downstack Pokémon WASM script-coverage
  threshold. The parent `#1847` controller cycle owns that separate blocker;
  this `#1848` cycle does not modify the parent branch.
- The exhaustive repository verification remains Buildkite's responsibility;
  this cycle intentionally ran only the backend-scoped commands.
