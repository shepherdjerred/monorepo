---
id: plan-2026-07-25-scout-ranked-splash-highres
type: plan
status: complete
board: false
---

# High-res centered splash art for scout-for-lol ranked report designs

Shipped on PR #924 (`claude/peaceful-driscoll-2a021a`): high-res centered splash
art + grade-letter centering.

## Context

PR #924 adds two ranked report designs (banner 4760×1500, square 4760×4760) that
render a full-bleed champion "splash" background. It was **deferred** because the
art is badly pixelated: `report/src/html/shared/splash.tsx` sources Data Dragon
**loading-screen** art via `getChampionLoadingImage`, only **308×560 px** —
upscaled ~15× onto the 4760 px canvas.

Fix: source high-res **centered splash art**. Measured options:

| Source                              | Resolution             | Notes                                       |
| ----------------------------------- | ---------------------- | ------------------------------------------- |
| `champion/loading/` (current)       | 308×560 portrait       | pixelated                                   |
| CommunityDragon **centered** splash | **1280×720** landscape | chosen — champion stays framed when cropped |
| ddragon `champion/splash/`          | 1215×717 landscape     | reliable fallback                           |

CommunityDragon centered endpoint takes the **numeric champion ID** directly
(`.../champion/{id}/splash-art/centered/skin/{n}`), so no CDragon game-data Zod
schema change is needed.

**Decisions:** download **skin-0 only** (~173 files, ~15MB — ranked designs
always render the hero at base skin 0; there is no skin parameter to fall back
from). Land **directly on PR #924's branch**.

## Changes

1. `data/scripts/update-data-dragon.ts` — `downloadSplashSkin` (centered CDragon
   by id → ddragon splash fallback), `downloadChampionSplashImages` (skin-0 only),
   `champion-splash/` dir, `main()` call, `MAX_SPLASH_IMAGE_BYTES`.
2. `data/src/data-dragon/images.ts` — `getChampionSplashImageBase64` (+ URL/validate),
   mirroring the loading helpers. Export from `data/src/index.ts` barrel.
3. `report/src/dataDragon/image-cache.ts` — `championSplashImageCache`,
   `getChampionSplashImage`, `preloadChampionSplashImages`.
4. `report/src/html/shared/splash.tsx` — use `getChampionSplashImage`.
   `report/src/html/index.tsx` — ranked preload → `preloadChampionSplashImages`.
5. Generate `champion-splash/*_0.jpg` assets; re-render the 4 banner + 4 square
   snapshot fixtures.

Non-ranked / loading-screen / arena reports are untouched (keep loading art).

## Verification

1. `bunx turbo run typecheck --filter=@scout-for-lol/data --filter=@scout-for-lol/report`
2. `cd packages/scout-for-lol/packages/report && bunx eslint .`
3. `bunx turbo run test --filter=@scout-for-lol/report`
4. Eyeball regenerated ranked `__snapshots__/*.svg` PNGs.
5. Attach before/after PR media via `toolkit pr asset 924 …`.
6. `bun run verify -- --affected`.

## Session Log — 2026-07-25

### Done

- `data/scripts/update-data-dragon.ts` — added `getCDragonCenteredSplashUrl`,
  `downloadSplashSkin` (centered CDragon by id → ddragon `champion/splash/`
  fallback), `downloadChampionSplashImages` (base skin-0 only) + `retryFailedSplashes`,
  `MAX_SPLASH_IMAGE_BYTES`, `champion-splash/` dir, and the `main()` call + summary.
- `data/src/data-dragon/images.ts` — `getChampionSplashImageBase64` /
  `getChampionSplashImageUrl` / `validateChampionSplashImage`; exported from `src/index.ts`.
- `report/src/dataDragon/image-cache.ts` — `championSplashImageCache`,
  `getChampionSplashImage`, `preloadChampionSplashImages`; extracted a shared
  `preloadChampionArt` driver so the loading + splash preloaders don't duplicate
  (cleared the `no-code-duplication` warning without suppression).
- `report/src/html/shared/splash.tsx` → `getChampionSplashImage`;
  `report/src/html/index.tsx` ranked preload → `preloadChampionSplashImages`.
- Generated 173 base-skin-0 splashes (all from CommunityDragon centered, 1280×720,
  ~16 MB) into `champion-splash/`; regenerated the 8 ranked snapshot fixtures.
- Verified: typecheck + eslint clean, 10 ranked/pick-design tests pass, pre-push
  `verify --affected` (49 tasks) green. Committed `d7d9c0d56`, pushed to PR #924.
- Posted before/after PR media (banner full + 1:1 zoom, square hero band) to
  PR #924 as a comment.
- Grade-letter centering (final `c025fb0da`): **root cause** — the flex-centered
  letter was always perfectly box-centered; satori/resvg rasterizes the
  `transform: rotate(45deg)` **diamond div's** bbox off-center by several px in a
  **layout-dependent direction** (+11px right in the banner squad row, −7px left
  in the square card — opposite signs), so the letter only _looked_ off, and no
  single padding could fix both designs. **Fix:** draw the diamond as an inline
  **SVG polygon** (`data:image/svg+xml` background on an axis-aligned div sized to
  `size·√2`, offset to overflow symmetrically); SVG rasterizes symmetrically so
  the box-centered letter aligns with no padding. Removed the earlier
  paddingTop/paddingBottom hacks.
- **Dead ends (don't repeat):** the first three attempts (`paddingBottom 0.08` →
  `0.035` → `paddingTop 0.45`, commits `c3cf5e3ab`/`e9543c7a3`) were calibrated on
  **isolated single-`GradeDiamond` renders**, which do NOT reproduce the layout
  offset — they gave the wrong direction and couldn't fix horizontal at all.
  Diagnosis that cracked it: a `#00ffff` box-center marker + separable debug
  colors (border `#ff0000`, letter `#ff00ff`) on the real `matchToSvg`→`svgToPng`
  output showed the letter on box-center and the _diamond_ off. Snapshots
  regenerated each iteration.
- Merged `origin/main` (`3ada892d5`), which brought in **#1640 "stop downloading
  unused champion skins"** (removed `champion-skins.json`, `skinNum` /
  `SkinFallbackEvent` plumbing, `ChampionDetailSkinsSchema`). Reconciled the
  splash code to main's skin-0-only, name-keyed shape: dropped `skinNum` /
  `SkinFallbackEvent` from `getChampionSplashImageBase64` /
  `validateChampionSplashImage` / `getChampionSplashImage` /
  `preloadChampionSplashImages` and the `Splash` component; folded the three
  preloaders (portrait/loading/splash) into one shared `preloadChampionArt`.

### Codex remediation follow-up (same day, separate session)

- Merged `origin/main` into the PR branch to pick up 4 CI-memory fixes (#1662
  "right-size verify memory", #1647 "tmpfs checkout memory", #1650 "retry
  Buildx import panic", #1639 "buildkitd cutover") that fix the repeated
  `verify --affected` OOM kill on this branch's Buildkite runs. Validated the
  merged `bun.lock` with `bun install --frozen-lockfile --dry-run`.
- Fixed a Codex P2 on `ranked-banner/report.tsx`: squad columns were sized off
  a hardcoded `isLargeSquad ? "50%" : "100%"`, which only covered exactly two
  groups; cross-guild duplicate configs can push `splitSquad` to 3+ groups.
  Added `squadGroupWidth(groupCount)` (mirrors `squadCardWidth` in
  ranked-square/report.tsx) sized off `squadGroups.length`, plus a regression
  test for an 11-player / 3-group render.
- Reclassified this plan's status `in-progress` → `awaiting-human` (and
  `verification` `agent` → `human`) and moved the un-defer checklist item from
  `## Remaining` to `## Human Verification`, matching `packages/docs/AGENTS.md`'s
  workflow-status conventions — the only remaining step is owner design review,
  not agent work.
- Corrected this doc's "non-zero skins fall back to `_0`" claim (Decisions +
  Caveats above): `getChampionSplashImageBase64` takes only a champion name and
  has no skin parameter, so there is no fallback to describe — ranked rendering
  simply always requests skin 0.
- Enrolled `champion-splash/*.jpg` in `packages/scout-for-lol/scripts/check-asset-sizes.ts`
  at the 2 MiB ceiling that `MAX_SPLASH_IMAGE_BYTES` in `update-data-dragon.ts`
  already declares but the asset gate never evaluated.

### Historical handoff

- PR #924 stays **deferred** — owner still needs to review the two designs before
  un-deferring. This change removes the low-res blocker the user cited.

### Caveats

- Splash art is **base skin 0 only** by design (~15 MB vs ~180 MB for all skins).
  `getChampionSplashImageBase64` takes only a champion name — it always loads
  `<champion>_0.jpg` and has no skin parameter, so there is no per-skin fallback;
  ranked rendering simply never requests anything but skin 0. Extending to
  skin-aware art = add a skin parameter to `getChampionSplashImageBase64` and
  iterate more skins in `downloadChampionSplashImages`.
- Assets were generated with a throwaway scratch script using the **same URLs** as
  the new pipeline (byte-identical output); a full `bun run update-data-dragon`
  would also refresh every other asset to the latest patch, which we deliberately
  avoided to keep the diff to `champion-splash/` only.
- The large empty lower region of the ranked-**square** design is **pre-existing**
  (visible in the before render); unrelated to this splash change. Flagged on the PR.

## Closure

Shipped in commit `83248fe03` / PR #924, reachable from `origin/main`. The merge
contains the high-resolution splash assets, centered grade treatment, ranked
designs, and regression coverage, so the stale un-defer checklist is resolved.
