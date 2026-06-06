---
id: large-file-cleanup
status: active
origin: packages/docs/plans/2026-05-31_bk-dagger-git-url-refactor.md
source_marker: false
---

# Move or remove pre-existing files >5 MB surfaced by the new Dagger `large-file-check`

## What

The pre-PR2 `largeFileStep` was a plain Buildkite step whose detection
clause was

```bash
large=$(find . -type f -size +5M ...) && \
  if [ -n "$large" ]; then ...exit 1; fi
```

`$large` got interpolated to the empty string by `buildkite-agent pipeline
upload` (same single-`$` semantics we deliberately rely on for
`$BUILDKITE_COMMIT`), so the `[ -n "" ]` test was always false and the
check has been a silent no-op for as long as it has existed. PR2 of the
BK-pressure reduction plan moved this to a Dagger function which runs the
detection inside the engine without going through pipeline-upload
interpolation — and immediately surfaced 8 pre-existing files >5 MB:

| File                                                                                                     | Size   |
| -------------------------------------------------------------------------------------------------------- | ------ |
| `packages/scout-for-lol/packages/backend/src/league/tasks/postmatch/__snapshots__/internal.test.ts.snap` | 44 MB  |
| `packages/discord-plays-pokemon/docs/docs/assets/videos/demo.mp4`                                        | 31 MB  |
| `packages/scout-for-lol/packages/data/src/data-dragon/assets/img/champion-loading/Renata_31.jpg`         | 13 MB  |
| `packages/scout-for-lol/packages/data/src/data-dragon/assets/img/champion-loading/Zed_69.jpg`            | 13 MB  |
| `packages/sjer.red/src/content/blog/2023/xstate/simulation.mp4`                                          | 11 MB  |
| `packages/scout-for-lol/assets/beta.jpeg`                                                                | 10 MB  |
| `packages/scout-for-lol/assets/scout.jpeg`                                                               | 8.9 MB |
| `packages/scout-for-lol/assets/banner.jpeg`                                                              | 8.0 MB |

Plus the three already in `.largeignore`:

| File                                                        | Size   |
| ----------------------------------------------------------- | ------ |
| `packages/sjer.red/src/content/blog/2024/pokemon/demo.mp4`  | 12 MB  |
| `packages/sjer.red/src/content/blog/2024/pokemon/demo2.mp4` | 8.3 MB |
| `packages/webring/src/testdata/rss-3.xml`                   | 7.0 MB |

## Why it's open

Cleaning these up is outside the scope of the BK-pressure plan. PR2 marks
`largeFileStep` as `softFail: true` so the check surfaces results without
blocking. Pick a path per file:

- **Snapshot file** (`internal.test.ts.snap`, 44 MB) — almost certainly
  the right move is to (a) shrink the snapshot to a representative subset
  and (b) regenerate. A 44 MB Vitest/Bun snapshot is a smell.
- **Champion-loading images** (Renata_31.jpg, Zed_69.jpg) — Riot CDN
  assets. Either downscale or fetch at build time instead of vendoring.
- **Blog / docs videos** (`simulation.mp4`, `demo.mp4`, etc.) — move to
  Git LFS or external object storage (R2/SeaweedFS) and serve from the
  CDN; keep a poster image in the repo.
- **Scout marketing assets** (`banner.jpeg`, `beta.jpeg`, `scout.jpeg`)
  — re-encode as WebP/AVIF. 8–10 MB jpeg is unnecessarily large for
  marketing imagery.
- **`rss-3.xml`** — test fixture. Consider trimming to a representative
  subset.

Once a file is genuinely intended to stay in the repo at >5 MB, add it
to `.largeignore` with a comment explaining why.

## Acceptance

`large-file-check` reports zero files outside `.largeignore` and
`largeFileStep` can be flipped back to a hard fail.
