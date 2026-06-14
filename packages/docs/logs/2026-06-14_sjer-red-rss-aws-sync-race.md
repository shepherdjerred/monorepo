# sjer.red `/rss.xml` 404 — AWS CLI sync upload/delete race

## Status

Complete

## Symptom

Static-site alert `[sjer.red/rss.xml] Static site endpoint is down (s3-static-sites)`. `https://sjer.red/rss.xml` returned 404 while every other path on the site served 200. The `sjer-red` SeaweedFS bucket had `rss/styles.xsl`, `index.html`, `_astro/*`, and every other built file, but no `rss.xml`.

## Diagnosis

Last successful `Deploy sjer.red` job was build [#4249](https://buildkite.com/sjerred/monorepo/builds/4249) at 2026-06-14T18:02:53Z. Job log shows a single `aws s3 sync dist s3://sjer-red/ --delete` invocation, but for the `rss.xml` key it emitted **both** actions:

```
upload: dist/rss.xml to s3://sjer-red/rss.xml
delete: s3://sjer-red/rss.xml
```

`dist/rss.xml` was demonstrably present in source (same job's astro build log shows `├─ /rss.xml (+199ms)`). A delete should not have been scheduled.

The earlier deploy in build [#4200](https://buildkite.com/sjerred/monorepo/builds/4200) at 06:56 UTC ran the exact same code and emitted the same delete+upload pair, but in **reversed order** — delete-then-upload, so the upload won and the file landed. #4249 happened to land upload-first-delete-second, so the file vanished. The order is racy across runs of the same deterministic input — the CLI scheduled `upload` and `delete` as separate work items in its parallel executor pool, and which finishes last is non-deterministic.

Every subsequent build (#4268, #4279, #4293, #4294) was canceled or failed before `Deploy sjer.red` could re-run, so the bucket stayed broken.

Root trigger: the well-known AWS CLI v1 sort-order ambiguity when a path-level holds both a file `N.ext` AND a directory `N/`. Here `dist/rss.xml` (file at root) and `dist/rss/styles.xsl` (file inside `dist/rss/` at root). Local-filesystem walk and S3 lex order (`.` is 0x2E, `/` is 0x2F, so `rss.xml` < `rss/styles.xsl` in S3 lex but a directory walk visits them in the opposite pairing) yield differently-paired iterators; the sync diff mis-marks `rss.xml` as both "needs upload" (matching it correctly against src) and "delete from dest" (mis-pairing it against the wrong src key).

## Fix

Eliminated the file/dir name collision at the bucket root so the sync diff is unambiguous.

- `git mv packages/sjer.red/public/rss/styles.xsl packages/sjer.red/public/rss-styles.xsl`
- Removed empty `public/rss/`.
- `packages/sjer.red/src/pages/rss.xml.ts:49` — `stylesheet: "/rss/styles.xsl"` → `stylesheet: "/rss-styles.xsl"`.

`astro build` now emits `dist/rss.xml` and `dist/rss-styles.xsl` at root with no `dist/rss/` subdirectory. The sync diff has no ambiguous pairings; no spurious `delete` is scheduled for the `rss.xml` key.

## Restore (out-of-band, before merge)

Live bucket re-seeded via single-object `cp` to clear the alert without waiting for CI:

```
AWS_PROFILE=seaweedfs aws --endpoint-url=https://seaweedfs.sjer.red s3 cp dist/rss.xml s3://sjer-red/rss.xml
AWS_PROFILE=seaweedfs aws --endpoint-url=https://seaweedfs.sjer.red s3 cp dist/rss-styles.xsl s3://sjer-red/rss-styles.xsl
```

`curl -sI https://sjer.red/rss.xml` → `HTTP/2 200, content-length: 190469, content-type: application/xml`. The stale `s3://sjer-red/rss/styles.xsl` is still in the bucket and will be cleaned up cleanly by the next post-merge `aws s3 sync --delete` run (no collision then, so the delete on that key lands deterministically).

## Scope check — other deploy buckets

Verified by listing `s3://cook/`, `s3://stocks-sjer-red/`, `s3://webring/`, `s3://resume/`, and `s3://scout-frontend/`, and by inspecting each package's `public/` dir. None has a top-level file `N.ext` paired with a top-level directory `N/`. sjer.red is the only site tripping the trigger.

## Out of scope (intentional)

- **Not** switching `aws s3 sync` to `rclone`/`s5cmd`/AWS CLI v2. The trigger is structural (overlapping file/dir name pair in `dist/`), not version-specific. Removing the overlap is a one-line content fix; swapping the deploy tool is a much larger blast radius for the same result on this specific bug.
- **Not** adding a pre-deploy collision linter to Dagger. Worth considering as defense-in-depth, but the trigger is rare enough that we'd rather catch it during a future deploy-tool refresh than instrument the deploy now.

## Session Log — 2026-06-14

### Done

- Diagnosed the upload/delete race from Buildkite job logs of #4249 vs #4200.
- Renamed `packages/sjer.red/public/rss/styles.xsl` → `public/rss-styles.xsl` and updated `src/pages/rss.xml.ts:49`.
- Verified locally: pre-fix build emits `dist/rss.xml` + `dist/rss/styles.xsl` (reproduces collision shape); post-fix build emits `dist/rss.xml` + `dist/rss-styles.xsl`, no `dist/rss/` dir.
- Manually restored the live bucket via `aws s3 cp` (not `sync`) — `https://sjer.red/rss.xml` returns 200 again.
- Branch `fix/sjer-red-rss` pushed; PR to follow.

### Remaining

- Merge the PR; watch the next `Deploy sjer.red` job confirm exactly one `upload: dist/rss.xml ...` and zero `delete: s3://sjer-red/rss.xml` lines, plus a single clean delete of the now-stale `s3://sjer-red/rss/styles.xsl`.

### Caveats

- Underlying AWS CLI v1 sync bug is unaddressed; the next collision-shaped `dist/` layout (file `N.ext` alongside dir `N/` at the same level) will trip the same race on any site. If we ever need to host another file-plus-stylesheet-dir pair, rename the dir from the start.
