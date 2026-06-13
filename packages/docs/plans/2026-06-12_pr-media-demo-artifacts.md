# PR Media & Demo Artifacts — extend `toolkit pr asset` + guidance

## Status

In Progress

## Context

The monorepo instructs agents to attach **screenshots** to PRs via `toolkit pr asset` (uploads to the `public-sjer-red` SeaweedFS bucket, serves from `https://public.sjer.red/pr/assets/<PR>/`). The user wants reviewers to be able to _see_ work without checking out the branch for more kinds of changes: UI flows (screen recordings), new features (per-scenario demo videos), CLI/TUI programs (asciinema terminal recordings), web pages/components (clickable static demo sites), and observability changes (e2e proof like Grafana screenshots). Explicit restraint rule: attach the **lightest artifact that proves the behavior** — most PRs need nothing; never attach media reflexively.

Decisions made with the user:

- **Scope:** guidance + tooling (extend `toolkit pr asset` so the guidance is actionable)
- **Placement:** monorepo `AGENTS.md` only (root `CLAUDE.md` is a symlink to it; global `~/.claude/CLAUDE.md` untouched)
- **Terminal recordings:** asciinema `.cast` (not VHS/plain recording), with a hosted player page

Key constraint: GitHub renders external **images/GIFs** inline via its camo proxy (`![](url)`), but **never embeds external video** — videos must be plain links that play in the browser tab (correct `Content-Type` at upload makes this work; the site serves with `X-Content-Type-Options: nosniff`, so upload-time types are authoritative).

## Summary

| #   | Change                                                      | Files                                                                                    |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Content-type map: add `.cast` + static-site types           | `packages/toolkit/src/lib/s3/assets.ts:15-33`                                            |
| 2   | Per-type `--markdown` emission (`markdownForAsset`)         | `assets.ts` (new fn), `packages/toolkit/src/commands/pr/asset.ts:83`                     |
| 3   | `.cast` → generate + upload self-contained HTML player page | new `packages/toolkit/src/lib/s3/cast-player.ts`, `asset.ts`, toolkit `package.json`     |
| 4   | Directory upload (static demo sites), auto-detected         | `asset.ts`, `assets.ts` (upload planning helper)                                         |
| 5   | Tests                                                       | `packages/toolkit/test/s3/assets.test.ts`, new `test/s3/cast-player.test.ts`             |
| 6   | Help/usage text                                             | `packages/toolkit/src/index.ts:30`, `src/handlers/pr.ts` usage strings, `asset.ts:16-27` |
| 7   | Rewrite guidance section                                    | root `AGENTS.md:305-327` ("PR Screenshots — public.sjer.red")                            |
| 8   | Update toolkit docs                                         | `packages/toolkit/AGENTS.md` ("`pr asset` — PR screenshot host" section)                 |
| 9   | Infra                                                       | **none needed** (see below)                                                              |

Commit scope: `feat(toolkit): ...`; root AGENTS.md edit can ride the same PR.

## 1. Content types (`assets.ts:15-33`)

Add to `CONTENT_TYPES`:

- `.cast` → `application/x-asciicast` (asciinema v2 NDJSON)
- Static-site essentials (nosniff means octet-stream scripts/styles are refused by browsers): `.css` → `text/css; charset=utf-8`, `.js`/`.mjs` → `text/javascript; charset=utf-8`, `.wasm` → `application/wasm`, `.woff2` → `font/woff2`, `.woff` → `font/woff`, `.ttf` → `font/ttf`, `.map` → `application/json`, `.xml` → `application/xml`, `.webmanifest` → `application/manifest+json`

## 2. Per-type markdown emission

New pure helper in `assets.ts`: `markdownForAsset(filename: string, url: string): string`, switching on the content-type class derived from the same `CONTENT_TYPES` map (no second extension list to drift):

| Type              | Emission                                                                        |
| ----------------- | ------------------------------------------------------------------------------- |
| `image/*`         | `![name](url)` — inline via camo; GIFs animate                                  |
| `video/*`         | `[name (video)](url)` — link; plays in browser tab                              |
| `text/html`       | `[name (demo)](url)`                                                            |
| `application/pdf` | `[name (pdf)](url)`                                                             |
| `.cast`           | handled at command level — emit link to the **player page**, never the raw cast |
| other             | `[name](url)`                                                                   |

Replace the unconditional `![...](...)` at `asset.ts:83`. (Behavior change for non-image files is a fix — camo never rendered them anyway.)

## 3. asciinema player page (vendored, inlined)

**Vendor, don't CDN:** add `asciinema-player` as a regular npm dependency of `packages/toolkit`; import its dist JS+CSS as text (Bun `with { type: "text" }`) and inline both into one generated HTML page (~350 KB, single object, no shared prefix, Renovate-managed version, no third-party runtime dependency for a 365-day artifact — homelab stays the only availability dependency).

New `packages/toolkit/src/lib/s3/cast-player.ts`: `renderCastPlayerHtml(castBasename: string): string` — minimal dark page, inlined `<style>`/`<script>`, `AsciinemaPlayer.create("./<basename>", el, { fit: "width" })` with a **relative** cast ref; escape/encode the basename in URL ref and `<title>`.

Command flow for a `.cast` input:

1. Upload `demo.cast` (`pr/assets/<PR>/demo.cast`, `application/x-asciicast`)
2. Upload generated `demo.cast.html` (`text/html; charset=utf-8`)
3. Print/markdown the `.html` URL only
4. Derived `.cast.html` key joins the pre-upload collision set (a user-supplied `demo.cast.html` must fail fast)

Note: confirm the installed package's dist paths at implementation time (`dist/bundle/asciinema-player.min.js` / `.css`); a moved path must fail typecheck/build, not runtime. Text imports need an ambient module declaration (no `as` assertions).

## 4. Directory upload (static demo sites)

**CLI shape: keep `pr asset <PR> <path...>`, auto-detect directories** via `stat` (today a directory is a hard "file not found" error at `asset.ts:63-68`, so this is strictly additive; no new flag).

- Stat each positional; branch file vs dir; follow symlinks (stat not lstat); fail fast on anything else
- **Fail fast if a directory lacks a root `index.html`** (the markdown link targets it)
- Walk recursively, skipping dotfiles/dotdirs; keys: `pr/assets/<PR>/<dirname>/<posix relative path>`
- New pure planning helper in `assets.ts` (e.g. `planAssetUploads`) producing `{ localPath, key, contentType }` entries with **full-key** collision detection (subsumes `firstDuplicateBasename` at `assets.ts:56-69`; covers file-vs-file, dir-vs-file, and derived `.cast.html` collisions). All validation/planning completes before the first `putObject` — preserves the documented atomic-precheck contract (`asset.ts:24-26`)
- URL building: encode per path segment (current `assetPublicUrl` at `assets.ts:47-50` encodes a single basename)
- `--markdown` for a dir emits `[<dirname> (demo site)](.../<dirname>/index.html)`; non-markdown prints the index.html URL. Direct index.html links mean no server-side SPA fallback is needed

## 5. Tests (pure helpers, no live bucket — follow `test/s3/assets.test.ts` patterns)

- `contentTypeForFile`: `.cast`, `.css`, `.js`, `.wasm`, `.woff2`
- `markdownForAsset`: one case per emission class
- `planAssetUploads`: nested keys, dir/file key collision, derived `.cast.html` collision, segment-encoded URLs with spaces
- `renderCastPlayerHtml` (new `test/s3/cast-player.test.ts`): relative cast ref present, inlined player marker, hostile basename escaped
- Dir walk: fixture dir under `test/fixtures/` or temp dir created in-test

## 6. Help/usage text

- `src/index.ts:30`: `pr asset <PR> <FILE|DIR...>  Upload PR media (images, video, .cast, demo dirs) to public.sjer.red`
- `src/handlers/pr.ts` usage strings (~lines 89, 96) to match; `handleAsset` (lines 44-58) needs no option changes
- `asset.ts:16-17` USAGE string + doc comment (19-27)

## 7. Root guidance rewrite (`AGENTS.md:305-327`)

Root `CLAUDE.md → AGENTS.md` symlink (verified) — one file. Replace the section:

- Retitle: `## PR Media & Demo Artifacts — public.sjer.red`
- Lead with restraint: _attach the lightest artifact that proves the behavior; most PRs (logic, refactors, types, config) need nothing — don't attach media reflexively; a single visual state is a screenshot, not a video_
- Taxonomy table (change type → artifact):
  - UI tweak, single state → screenshot (before/after)
  - UI flow/interaction/animation → short GIF (renders inline) or short video (link)
  - Brand-new feature → e2e demo, **one short video per scenario** (not one long tour), each captioned
  - CLI/TUI → asciinema: `asciinema rec demo.cast -c "<command>"`, upload the `.cast`; toolkit emits a player-page link
  - Web page/component → static demo dir (root `index.html` required), upload the directory
  - Metrics/logging/tracing → screenshot of Grafana/Loki showing the **new** data flowing e2e
  - Other static artifacts → only when they communicate faster than reading the diff
- Embedding constraints: images/GIFs inline via `![](url)`; external videos never embed in PR bodies — they're links that play in-browser; `.cast` links to a self-contained player page
- Conventions: one artifact per scenario, one-line caption saying what to look at, before/after pairs for changed behavior
- Updated command example covering png + mp4 + .cast + a directory; keep creds/profile, 365-day expiry, homelab-must-be-up notes (condensed from current lines 311-326)

## 8. Toolkit docs (`packages/toolkit/AGENTS.md`)

Retitle section to `## pr asset — PR media host`; document dir auto-detect + `index.html` requirement + key layout, `.cast` player-page generation (vendored asciinema-player, inlined), per-type markdown emission table, full-key collision/atomic-precheck rule, new `asciinema-player` dependency.

## 9. Infra — nothing to change

- Lifecycle rule (`packages/homelab/src/tofu/seaweedfs/buckets.tf:46-70`) is prefix-scoped to `pr/assets/` — covers nested dir keys and player pages automatically
- Static serving (`packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts:96-98`): no SPA fallback needed; nosniff satisfied by item 1

## Sequencing

1. `assets.ts`: content types + `markdownForAsset` + key/URL/planning helpers (+ tests)
2. `cast-player.ts` + `asciinema-player` dep (+ tests)
3. `asset.ts` command rewrite (stat branch, walk, plan, upload loop, per-type output)
4. Help text
5. AGENTS.md (root + toolkit)
6. Verify

## Verification

```bash
cd packages/toolkit && bun run typecheck && bun test && bunx eslint . --fix
```

Manual e2e with a scratch PR number (link-liveness rule — every URL must HEAD 200 with the right Content-Type):

```bash
toolkit pr asset 99999 shot.png clip.mp4 demo.cast ./demo-site --profile seaweedfs --markdown
curl -sI https://public.sjer.red/pr/assets/99999/shot.png              # 200, image/png
curl -sI https://public.sjer.red/pr/assets/99999/clip.mp4              # 200, video/mp4
curl -sI https://public.sjer.red/pr/assets/99999/demo.cast.html        # 200, text/html
curl -sI https://public.sjer.red/pr/assets/99999/demo-site/index.html  # 200, text/html
```

Open `demo.cast.html` in a browser to confirm the inlined player loads the cast via the relative ref.
