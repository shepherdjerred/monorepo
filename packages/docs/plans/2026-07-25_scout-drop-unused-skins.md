---
id: scout-drop-unused-skins
type: plan
status: planned
board: true
verification: human
disposition: active
---

# Scout: stop downloading unused champion skins + retire skin plumbing

## Context

`packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts` downloads the
loading-screen splash art for **every non-chroma skin of every champion** — 2,105
JPGs / **104 MB**, all committed to git and shipped into the backend image
(`packages/backend/Dockerfile:26`), refreshed weekly by the Temporal schedule
`scout-data-dragon-weekly-refresh`.

But **every render path hardcodes skin 0**. Only the 173 `*_0.jpg` base skins are
ever displayed; the other **1,932 non-zero skins (~92%, ~100 MB)** are dead weight.
The helpers written to select a real skin (`resolveLoadingSkinNum` /
`getAvailableSkins` / `isSkinAvailable` + `champion-skins.json`) have **zero
callers** anywhere in the monorepo — a feature that was never wired up.

**Outcome:** stop downloading non-zero skins, delete the committed non-zero JPGs,
and rip out the now-provably-always-0 `skinNum` plumbing end-to-end (chosen: _full
removal_). A git history rewrite to reclaim the ~108 MB from history is a **separate,
coordinated follow-up** (chosen: _code PR now, rewrite later_) — see the last section.

All paths below are relative to `packages/scout-for-lol/`.

## Changes

| Area            | File                                                                                        | Change                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Downloader      | `packages/data/scripts/update-data-dragon.ts`                                               | Gate to skin 0 only; drop chroma/skin-map bookkeeping + `champion-skins.json` emission                                  |
| Assets          | `packages/data/src/data-dragon/assets/img/champion-loading/*_[1-9]*.jpg`                    | `git rm` the 1,932 non-zero JPGs (keep `*_0.jpg`)                                                                       |
| Assets          | `packages/data/src/data-dragon/assets/champion-skins.json`                                  | `git rm` (no remaining consumer)                                                                                        |
| Dead helpers    | `packages/data/src/data-dragon/champion-skins.ts`                                           | Delete file                                                                                                             |
| Barrel          | `packages/data/src/index.ts`                                                                | Remove the 3 skin-helper exports (173-177) + `SkinFallbackEvent` export (171)                                           |
| Data loader     | `packages/data/src/data-dragon/images.ts`                                                   | Drop `skinNum`/`onSkinFallback` params + fallback block + `SkinFallbackEvent` type from `getChampionLoadingImageBase64` |
| Data model      | `packages/data/src/model/loading-screen.ts:88-89`                                           | Remove `skinNum` field from `BaseLoadingScreenParticipantSchema`                                                        |
| Backend builder | `packages/backend/src/league/tasks/prematch/loading-screen-builder.ts:42,173`               | Remove `DEFAULT_LOADING_SCREEN_SKIN_NUM` + the `skinNum:` field                                                         |
| Backend metric  | `packages/backend/src/metrics/index.ts:234` + `prematch-notification.ts:33,35,209-221`      | Delete `prematchLoadingScreenSkinFallbackTotal` counter + `onSkinFallback` wiring                                       |
| Report cache    | `packages/report/src/dataDragon/image-cache.ts`                                             | Drop `skinNum` from `getChampionLoadingImage` + `preloadChampionLoadingImages`; cache key = normalized name only        |
| Report loading  | `packages/report/src/html/loading-screen/index.tsx:102,117,121` + `player-card.tsx:176-179` | Drop `skinNum`/`onSkinFallback` from options + `getChampionLoadingImage` call                                           |
| Report arena    | `packages/report/src/html/arena/index.tsx:56` + `utils.ts:5` + `player-column.tsx:47`       | Remove `ARENA_DEFAULT_SKIN_NUM` + the `skinNum` arg                                                                     |
| Tests           | `*.test.ts(x)` for the above                                                                | Update to the new signatures/schema; re-record report snapshots                                                         |

### Notes on specifics

- **Downloader gate** (`update-data-dragon.ts` `downloadChampionLoadingImages`, 619-780):
  reduce `intendedSkins` to `[0]` per champion and remove the chroma map, `baseSkins`
  /`chromaToParent`, and the `champion-skins.json` write (732-738) + its header comment
  (608). Keep the CommunityDragon fallback + propagation-lag retry (still useful for a
  brand-new champion's skin 0). If `ChampionDetailSkinsSchema` becomes unused, remove it
  (knip will flag).
- **`skinNum` schema removal is safe:** `buildLoadingScreenData` builds the struct fresh
  from the spectator API and `LoadingScreenDataSchema.parse`s it for immediate rendering
  (`loading-screen-builder.ts:428` → `prematch-notification.ts:197`). It is **never
  persisted and re-parsed**, so dropping the field from the `z.strictObject` breaks no
  stored records.
- **`getChampionLoadingImageBase64` simplifies** to: load `{name}_0.jpg`, throw if
  missing (the `skinNum !== 0` → `_0` fallback block is dead once no non-zero skin is
  ever requested).
- **Delete command for assets:**
  `git ls-files 'packages/scout-for-lol/packages/data/src/data-dragon/assets/img/champion-loading/*.jpg' | grep -v '_0\.jpg$' | xargs git rm` (stages specific files — no `git add -A`).

## Verification

1. `bunx turbo run typecheck test lint --filter=@scout-for-lol/data --filter=@scout-for-lol/report --filter=@scout-for-lol/backend` — green.
2. `bunx turbo run knip --filter=@scout-for-lol/data` — no new unused exports (confirms the removed helpers/type are fully gone).
3. Report snapshot tests: run; snapshots should be **unchanged** (skin 0 was always the
   rendered image) — a diff means an accidental behavior change, investigate.
4. Sanity-run the downloader in a throwaway checkout to confirm it writes only `*_0.jpg`
   and no `champion-skins.json` (don't commit the re-downloaded assets).
5. `bun run verify -- --affected` before commit (pre-push gate parity).
6. PR: attach a before/after of a rendered prematch loading screen (should be pixel-identical) to prove no visual regression, plus the file-count / repo-size delta.

## Deferred follow-up — git history rewrite (separate, coordinated)

Do **not** run this in the code PR. Reclaims ~108 MB of champion-loading history
(~10% of the 1.0 GB `.git`), but: it force-pushes a rewritten `main` (every SHA from
`2f721e34f` forward changes), **strands all 13 active worktrees + open PRs** (each must
be rebased/re-created), invalidates SHA refs in release-pair tags/docs, and **GitHub
will not GC server-side immediately** (fresh clones benefit; the remote stays large
until GitHub's own GC / a support request). Run only when worktrees/PRs are quiescent.

Procedure (fresh mirror clone, `git-filter-repo` is installed):

```bash
git clone --mirror git@github.com:shepherdjerred/monorepo.git monorepo-rewrite.git
cd monorepo-rewrite.git
git filter-repo --force --filename-callback '
return None if (b"/champion-loading/" in filename and not filename.endswith(b"_0.jpg")) else filename
'
# review size delta, then coordinate the force-push + re-clone
```

The callback keeps `*_0.jpg` at every commit (still used at the tip) and drops only the
non-zero blobs from all 48 historical commits.

## Remaining

- [ ] Execute the deferred git history rewrite when worktrees/PRs are quiescent —
      tracked in [`todos/scout-champion-loading-history-rewrite.md`](../todos/scout-champion-loading-history-rewrite.md).

## Session Log — 2026-07-25

### Done

- Gated the downloader to skin 0 only (`packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts`
  `downloadChampionLoadingImages`); removed the now-unused `ChampionDetailSkinsSchema`
  from `update-data-dragon-schemas.ts`.
- `git rm`'d the 1,932 non-zero champion-loading JPGs (kept 173 `*_0.jpg`),
  `champion-skins.json`, and the zero-caller `champion-skins.ts` helpers +
  their barrel exports.
- Ripped out the always-0 `skinNum` plumbing end-to-end: `loading-screen.ts`
  schema field, `getChampionLoadingImageBase64` / `validateChampionLoadingImage`
  (`images.ts`), `image-cache.ts` (`getChampionLoadingImage` /
  `preloadChampionLoadingImages`), loading-screen `index.tsx` + `player-card.tsx`,
  arena `index.tsx` / `utils.ts` / `player-column.tsx`, and the backend
  `loading-screen-builder.ts`.
- Deleted the dead `prematchLoadingScreenSkinFallbackTotal` metric + its
  `onSkinFallback` wiring (`metrics/index.ts`, `prematch-notification.ts`).
- Updated tests + fixtures (data `images`/`loading-screen`, report `image-cache`
  - the 3 loading-screen testdata JSONs, backend loading-screen-builder snapshot).
- Verified: typecheck/lint/test green for data/report/backend; **19 report
  render snapshots unchanged** (no visual regression — skin 0 was always rendered);
  `bun run verify -- --affected` green.

### Remaining

- Git history rewrite (deferred) — see the `## Remaining` item above.

### Caveats

- The history rewrite is intentionally NOT part of the code PR; running it
  force-pushes `main` and strands active worktrees/PRs (see the todo).
- `getChampionLoadingImageUrl` (a generic ddragon CDN-URL builder) keeps its
  `skinNum` param — it is not tied to on-disk assets, so it was left as-is.
