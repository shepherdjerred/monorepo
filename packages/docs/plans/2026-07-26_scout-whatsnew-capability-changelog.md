---
id: plan-2026-07-26-scout-whatsnew-capability-changelog
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout "What's New" — capability-focused changelog + feature backfill

## Context

Scout's public **What's New** page (`scout-for-lol.com/whatsnew`) had two problems:

1. **The latest entries read like Riot's balance notes.** Patch 26.14 and 26.13
   listed per-champion buffs/nerfs, item nerfs, and Blue Buff scaling — none of
   which Scout _does_ anything with. Scout only refreshes data and, occasionally,
   adds support for something new. The changelog should reflect **Scout's**
   capabilities, not Riot's balance pass.
2. **A gap in the story.** Since the last real feature entry (May 23, 2026), the
   only new entries were the two patch data-refreshes — yet Scout shipped a large
   amount of user-facing work (self-serve web dashboard, redesigned ranked
   report, report-query editor + analytics, per-queue notification filters, …)
   that never reached the page.

**Root cause of #1:** these entries are auto-generated every patch. The LLM patch
analysis in `patch-analysis.ts` emitted a `summary[]` of player-facing balance
bullets that served double duty — feeding both the roasting-AI review context and
the changelog. Correct for the roast, wrong for the changelog, so every patch
reintroduced balance noise. A hand-edit alone would be undone by patch 26.15.

## What shipped

### A. Generator — changelog gets its own field

- `packages/scout-for-lol/packages/data/src/data-dragon/patch-notes.ts`: added
  `changelogHighlights: z.array(z.string().min(1)).max(4).default([])` to
  `PatchChangesetSchema`, separate from the balance `summary`. `.default([])`
  keeps older committed `patch-notes.json` assets valid.
- `packages/scout-for-lol/packages/data/scripts/patch-analysis.ts`: extended
  `buildAnalysisPrompt` to emit `changelogHighlights` with rules — Scout-relevant
  changes only (new champion, new/returning queue or mode, Arena augments,
  role-specific items), at most one headline balance line, usually empty.
- `packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts:1176`:
  changelog now reads `changeset.changelogHighlights` instead of `summary`. The
  AI-review path (`formatPatchNotes` / `buildPatchContext`) still reads `summary`
  — untouched.

### B. Rewrote the two current patch entries

- `packages/scout-for-lol/packages/frontend/src/data/changelog.tsx`: 26.14 →
  data-refresh line + one balance headline; 26.13 → data + Locke + Ranked 5v5 +
  one compressed balance line.

### C. Backfilled 4 feature entries (May 23 → now)

Inserted into `changelog.tsx` in correct newest-first array order (the page
renders array order — `whatsnew.astro` `changelog.map`, no sort):

- **07 25** — Ranked report redesign (banner + square) + delegated dashboard
  roles (RBAC) + unified champion names.
- **07 12** — Report analytics expansion + smarter report builder + subscription
  queue filters/mute/groups + Arena classification fix.
- **06 26** — Ranked 5v5 + automatic new-champion support.
- **06 19** — Self-serve web dashboard (onboarding, competitions, reports, Riot-ID
  search) + report query studio (Monaco editor, RENDER clause).

**Excluded:** richer AI match reviews (#1380) — the AI review/roast is gated to
the owner's personal guild, not a general feature, so it is deliberately kept off
the public changelog. Also excluded: internal/ops work (DuckDB re-architecture,
guild-lifecycle reliability, deploy plumbing, docker slimming, SEO/OG polish).

### D. Tests

- `patch-analysis.test.ts`: prompt asks for `changelogHighlights`; parse
  round-trips it and defaults to `[]` when omitted.
- `patch-notes.test.ts`: schema defaults `changelogHighlights` to `[]`, accepts
  ≤4 bullets, rejects >4.
- `update-changelog.test.ts`: already covered empty + non-empty highlights
  (`buildPatchChangelogEntryLiteral` signature unchanged) — no edit needed.

## Verification

- `bunx turbo run typecheck test --filter=@scout-for-lol/data` — 494 tests pass,
  0 typecheck errors.
- `bunx turbo run typecheck build --filter=@scout-for-lol/frontend` — 0 errors,
  `/whatsnew` builds; built HTML renders dates newest-first
  (07 25 → 07 19 → 07 12 → 06 28 → 06 26 → 06 19 → 05 23) with the old balance
  noise gone.
- `bun run verify -- --affected` — exit 0, 31 tasks. (Pre-existing
  `no-code-duplication` warnings in unrelated `app/`/docs pages only.)

## Remaining

- [ ] Confirm whether the report builder's AI-_draft_ helper (#1387/#1513, the
      "live AI-draft preview / visible AI credits" clause in the 07 12 entry) is a
      general metered web-app feature or also personal-guild-gated. If restricted,
      drop that clause from the 07 12 "cleaner report builder" bullet.
- [ ] Attach the `/whatsnew` screenshot to the PR and promote from draft after
      review.

## Session Log — 2026-07-26

### Done

- Parts A–D implemented and verified in worktree
  `feature/scout-whatsnew-capability-changelog` (see file list above).
- `bun run verify -- --affected` green (exit 0).

### Caveats

- The homepage `WhatsNewBanner` now surfaces the 07 25 ranked-reports entry (a
  real feature) instead of a patch note — intended; reverts to the newest patch
  entry when the generator inserts the next one.
- Future auto-generated patch entries will show only the data-refresh line unless
  the patch genuinely adds a Scout capability (new champ/queue/mode) — by design.
