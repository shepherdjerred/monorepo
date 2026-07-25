# High-res centered splash art for scout-for-lol ranked report designs

## Status

Complete — shipped on PR #924 (`claude/peaceful-driscoll-2a021a`, commit
`d7d9c0d56`). PR itself remains deferred pending owner review of the designs.

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

**Decisions:** download **skin-0 only** (~173 files, ~15MB — ranked designs only
render the hero at skin 0; non-zero skins fall back to `_0`). Land **directly on
PR #924's branch**.

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

### Remaining

- PR #924 stays **deferred** — owner still needs to review the two designs before
  un-deferring. This change removes the low-res blocker the user cited.

### Caveats

- Splash art is **base skin 0 only** by design (~15 MB vs ~180 MB for all skins);
  the ranked designs only render the hero at skin 0. Non-zero skins fall back to
  `_0` via `getChampionSplashImageBase64`. Extending to skin-aware art = iterate
  more skins in `downloadChampionSplashImages`.
- Assets were generated with a throwaway scratch script using the **same URLs** as
  the new pipeline (byte-identical output); a full `bun run update-data-dragon`
  would also refresh every other asset to the latest patch, which we deliberately
  avoided to keep the diff to `champion-splash/` only.
- The large empty lower region of the ranked-**square** design is **pre-existing**
  (visible in the before render); unrelated to this splash change. Flagged on the PR.
