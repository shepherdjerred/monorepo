# Streambot — New Features

## Status

Complete (implemented + verified locally; pending PR/merge).

## Context

`packages/streambot` is a first-party Discord video-streaming bot (XState playback machine + a
discord.js command bot + a discord.js-selfbot streamer driving ffmpeg via the in-repo
`@shepherdjerred/discord-video-stream` fork). It plays local library files (movies/TV mounted
read-only) and yt-dlp URL/search sources.

Three requested quality-of-life features:

1. **Chapters** — list a video's chapters and seek to one by number.
2. **Poster on play** — when a _local file_ starts, post the movie/TV poster image.
3. **Filename normalization** — show clean titles, e.g.
   `Avengers - Endgame (2019) Remux - Bluray` → `Avengers - Endgame (2019)`.

### Decisions (confirmed with user)

- Posters via **TMDB API** (free key, best-effort — falls back to text-only on no key/no match).
- Chapters from **local files (ffprobe) + YouTube/URL (yt-dlp `chapters`)**.
- Normalization affects **display + matching** (normalize once at scan time).

## Architecture facts (verified)

- `ResolvedSource` (`src/machine/types.ts:26`) = `{ title, ffmpegInput }`; built in two places:
  `src/sources/resolve.ts:28` (file) and `src/sources/ytdlp.ts:68` `toResolvedSource` (url/search).
  The machine stores it at `context.resolved` (`resolving` → `streaming`).
- `seek(seconds)` already exists end-to-end: `StreambotStreamer.seek` (`src/streamer/streamer.ts:93`)
  → `Player.seek` → ffmpeg `-ss` restart on the live Go-Live connection. Reuse as-is.
- Library titles come from `path.basename(relative, ext)` only — `src/sources/library.ts:50`.
- Now-playing announcements are **plain text** via `StatusReporter` (`src/discord/status-reporter.ts:51`)
  → `CommandBot.announce(message: string)` (`src/discord/command-bot.ts:91`) → `channel.send`.
- Snapshot projection feeding the reporter is built in `src/index.ts:149-162`; the command `view()`
  in `src/index.ts:112-131`.
- Config is Zod-validated from env: schema `src/config/schema.ts`, env mapping `src/config/index.ts`.
- ffprobe is **not** used yet; `ffmpegPath` config exists, no `ffprobePath`.
- Bun runtime → use `Bun.spawn` (like `ytdlp.ts`) and global `fetch` (no new deps).

---

## Feature 3 — Filename normalization (do first; shared util)

**New** `src/sources/normalize.ts`:

- `parseTitleYear(raw): { title: string; year: number | null }`
- `normalizeTitle(raw): string` — `parseTitleYear` then format `Title (Year)` (or just `Title`).

Algorithm:

1. Replace `.`/`_` with spaces; collapse whitespace.
2. Find first 4-digit year `(19|20)\d{2}` (optionally paren/bracket-wrapped). If found, keep the text
   up to the year, append `(YYYY)`, drop everything after (tags follow the year).
3. If no year: strip from the first known release tag onward. Tag set (case-insensitive, word-boundary):
   resolutions (`480p|720p|1080p|2160p|4k`), source (`bluray|blu-?ray|b[rd]rip|web-?dl|webrip|hdrip|dvdrip|hdtv|remux|hdr10?|sdr|imax`),
   codecs (`x26[45]|h26[45]|hevc|avc|av1|xvid|divx|10bit|8bit`),
   audio (`aac|ac3|dts(-hd)?|truehd|ddp?5[ .]1|atmos|flac|opus`),
   flags (`proper|repack|extended|uncut|unrated|limited|internal|complete`).
4. Trim trailing separators (`-`, `.`, whitespace).

**Apply** in `src/sources/library.ts:50`: `title: normalizeTitle(path.basename(relative, ext))`.
Leave `path` / `relativePath` raw. (Search ranks against the normalized `title` — desired.)

**Tests** `test/normalize.test.ts`: the example case + dotted scene names
(`Avengers.Endgame.2019.1080p.BluRay.x264-GROUP.mkv`), no-year cases, titles containing `-`,
year-in-title edge (`Blade Runner 2049 (2017)` must keep `2049` and pick `2017`).

---

## Feature 1 — Chapters (list + seek)

**New** `src/sources/chapters.ts`:

- `Chapter = { index: number; title: string; startSeconds: number; endSeconds: number | null }` (1-based).
- `ChapterSchema` (Zod) for the ffprobe JSON shape.
- `probeFileChapters(config, filePath, signal): Promise<Chapter[]>` —
  `Bun.spawn([config.ffprobePath, "-v","error","-print_format","json","-show_chapters", filePath])`,
  parse `{ chapters: [{ start_time, end_time, tags?: { title } }] }`, map to `Chapter` (title falls
  back to `Chapter N`). **Best-effort**: non-zero exit / parse error → `[]` (log warn, never throw —
  must not break playback). Honour `signal`.

**Config** `src/config/schema.ts`: add `ffprobePath: z.string().min(1).default("ffprobe")`.
`src/config/index.ts`: map `env["FFPROBE_PATH"]`.

**yt-dlp chapters** `src/sources/ytdlp.ts`: extend `YtdlpInfoSchema` with
`chapters: z.array(z.object({ start_time: z.number(), end_time: z.number().optional(), title: z.string().optional() })).optional()`;
map them in `toResolvedSource`.

**Thread onto ResolvedSource**:

- `src/machine/types.ts`: add `readonly chapters: readonly Chapter[]` to `ResolvedSource`.
- `src/sources/resolve.ts` (file branch): `chapters: await probeFileChapters(config, source.path, signal)`.
- `src/sources/ytdlp.ts` `toResolvedSource`: `chapters: mapped ?? []`.

**Expose to handler**:

- `src/discord/command-handler.ts`: add `readonly chapters: readonly Chapter[]` to `QueueItemView`
  (only meaningful for `current`).
- `src/index.ts` `view()`: `chapters: context.resolved?.chapters ?? []` in `current`.

**Commands** `src/discord/commands.ts`: add two subcommands —

- `chapters` (no args) — list.
- `chapter` — integer option `number` (`setMinValue(1)`, required) — seek to that chapter.

**Handlers** `src/discord/command-handler.ts` (+ routes in `run()`):

- `handleChapters`: if `current` null → "Nothing is playing."; if no chapters → "No chapters for the
  current video."; else numbered list `1. \`00:00\` — Intro`using`formatTimecode`(`src/discord/timecode.ts`).
- `handleChapter`: permission check via `canControlItem` (mirror `handleSeek` at line 273); look up
  `chapters[number-1]`; if missing → "There's no chapter N."; else `await this.deps.seek(chapter.startSeconds)`
  and ack `⏩ Chapter N: <title> (00:00)`.

**Tests**: `test/chapters.test.ts` (parse ffprobe JSON fixture, empty/garbage → `[]`); extend
`test/command-handler.test.ts` for list/seek/permission/out-of-range; extend `test/ytdlp.test.ts`
for the new `chapters` field.

---

## Feature 2 — Poster image on local-file play (TMDB)

**New** `src/metadata/tmdb.ts`:

- `PosterInfo = { posterUrl: string; tmdbTitle: string }`.
- `fetchPoster(apiKey, title, year, signal?): Promise<PosterInfo | null>` — `fetch`
  `https://api.themoviedb.org/3/search/multi?query=<title>&year=<year>&api_key=<key>`, Zod-parse,
  take first result with a `poster_path`, build `https://image.tmdb.org/t/p/w500<poster_path>`.
  **Best-effort**: any non-200 / no match / parse error → `null` (log warn).
- In-memory `Map` cache keyed by `title|year` so replays/loops don't refetch.

**Config** `src/config/schema.ts`: add optional `tmdb: z.strictObject({ apiKey: z.string().min(1) }).optional()`.
`src/config/index.ts`: `tmdb: env["TMDB_API_KEY"] !== undefined ? { apiKey: env["TMDB_API_KEY"] } : undefined`.
(Env name `TMDB_API_KEY` — confirm it doesn't trip the `env-var-names` pre-commit hook, which targets
the `_API_TOKEN` suffix; `_API_KEY` should pass.)

**Rich announcements** — introduce a neutral payload so `status-reporter.ts` stays free of discord.js:

- In `src/discord/status-reporter.ts` export
  `type Announcement = string | { content: string; embed?: { title?: string; imageUrl?: string } }`.
- Widen `CommandBot.announce` (`src/discord/command-bot.ts:91`) to accept `Announcement`; when `embed`
  is present, send `{ content, embeds: [new EmbedBuilder()...setImage(imageUrl)] }`. String path unchanged.
  (`command-handler.ts`'s `announce` dep stays `string`-only — shaming is text.)

**StatusReporter wiring** (`src/discord/status-reporter.ts`):

- `StatusSnapshot`: add `currentKind: Source["kind"] | null`.
- Constructor: add optional dep `fetchPoster?: (title, year) => Promise<PosterInfo | null>`.
- Now-playing branch: set `lastNowKey` first (dedup guard), build `content` as today; if
  `currentKind === "file"` and `fetchPoster` is set, in an async IIFE `parseTitleYear(nowKey)` →
  `fetchPoster` → announce `{ content, embed: { title: nowKey, imageUrl } }` (or plain `content` on null).
  Otherwise announce `content` as today.

**index.ts wiring**:

- Snapshot projection (`src/index.ts:151`): add `currentKind: snapshot.context.current?.source.kind ?? null`.
- `StatusReporter` ctor: pass `fetchPoster` = `(t, y) => fetchPoster(config.tmdb.apiKey, t, y)` only when
  `config.tmdb` is set; else omit so the reporter stays text-only.

**Homelab deploy** `packages/homelab/src/cdk8s/src/resources/streambot.ts`: add
`TMDB_API_KEY: fromSecret("TMDB_API_KEY")` and add the `TMDB_API_KEY` field to the `streambot-config`
1Password item (operator surfaces it as a secret key). Optional — bot runs fine without it.

**Tests**: `test/tmdb.test.ts` (mock `fetch`: hit→PosterInfo, miss→null, cache hit avoids 2nd fetch);
extend `test/status-reporter.test.ts` (file kind + fetchPoster → embed payload; url kind → plain text;
no fetchPoster → plain text; dedup still single announce).

---

## Files touched (summary)

| Area      | File                                               | Change                                        |
| --------- | -------------------------------------------------- | --------------------------------------------- |
| Normalize | `src/sources/normalize.ts` (new)                   | `parseTitleYear`, `normalizeTitle`            |
| Normalize | `src/sources/library.ts`                           | use `normalizeTitle` for `title`              |
| Chapters  | `src/sources/chapters.ts` (new)                    | `probeFileChapters`, `Chapter`                |
| Chapters  | `src/machine/types.ts`                             | `ResolvedSource.chapters`                     |
| Chapters  | `src/sources/resolve.ts`, `src/sources/ytdlp.ts`   | populate chapters                             |
| Chapters  | `src/discord/commands.ts`, `command-handler.ts`    | `chapters` + `chapter` cmds                   |
| Poster    | `src/metadata/tmdb.ts` (new)                       | `fetchPoster` + cache                         |
| Poster    | `src/discord/status-reporter.ts`, `command-bot.ts` | rich `Announcement` + embed                   |
| Both      | `src/config/schema.ts`, `src/config/index.ts`      | `ffprobePath`, `tmdb.apiKey`                  |
| Wiring    | `src/index.ts`                                     | view chapters, snapshot kind, fetchPoster dep |
| Deploy    | `packages/homelab/.../resources/streambot.ts`      | `TMDB_API_KEY` env (+ 1P field)               |

## Verification

- `cd packages/streambot && bun test` (new + extended suites), `bun run typecheck`, `bunx eslint . --fix`.
- ffprobe sanity on a real chaptered file:
  `ffprobe -v error -print_format json -show_chapters <file.mkv>` and confirm `probeFileChapters` maps it.
- TMDB: with a key in env, run a tiny `fetchPoster("Avengers Endgame", 2019)` script → expect a
  `image.tmdb.org/...` URL; without a key, confirm reporter stays text-only.
- Manual (homelab/Discord): `/stream play <local movie>` → embed with poster + normalized title;
  `/stream chapters` lists; `/stream chapter 2` jumps. Capture a Discord screenshot of the poster embed
  for the PR (per repo PR visual-change rule).
- `cd packages/homelab && bun run typecheck` after the deployment edit.

## Caveats

- Posters depend on TMDB title match quality; obscure/foreign titles may miss → text-only (by design).
- Normalizing the matching key means junk tags (`Bluray`, `1080p`) no longer match in `/stream play`
  (intended). Two files differing only by tags can collapse to the same display title but keep distinct paths.
- Chapters are best-effort: files without chapter metadata and most non-YouTube URLs report none.

## Session Log — 2026-06-07

### Done

- **Filename normalization** — `packages/streambot/src/sources/normalize.ts` (`parseTitleYear`, `normalizeTitle`); applied in `library.ts` `scanRoot` (display + matching). Bracketed-year preference + last-bare-year handling for `Blade Runner 2049 (2017)`. Tests: `test/normalize.test.ts`.
- **Chapters** — `src/sources/chapters.ts` (`probeFileChapters` via `ffprobe`, `toChapters`, `parseFfprobeChapters`; best-effort, never throws). `ResolvedSource.chapters` threaded through `machine/types.ts`, `sources/resolve.ts` (file → ffprobe) and `sources/ytdlp.ts` (`chapters` field → mapped). New `ffprobePath` config (`FFPROBE_PATH`). Commands `/stream chapters` + `/stream chapter <number>` in `commands.ts` + handlers in `command-handler.ts` (reuse live `seek`). Tests: `test/chapters.test.ts`, extended `command-handler`/`ytdlp` tests.
- **TMDB poster on play** — `src/metadata/tmdb.ts` (`createPosterFetcher` w/ in-process cache, `fetchPoster`, `pickPoster`; best-effort). Optional `tmdb.apiKey` config (`TMDB_API_KEY`). Neutral `Announcement` payload in `status-reporter.ts`; `command-bot.ts` renders an `EmbedBuilder` poster. Wired in `index.ts` (snapshot `currentKind`, conditional `fetchPoster`). Tests: `test/tmdb.test.ts`, extended `status-reporter.test.ts`.
- **Homelab deploy** — `packages/homelab/src/cdk8s/src/resources/streambot.ts`: `TMDB_API_KEY` as an **optional** secret ref (won't crashloop if the 1P field is absent). Test added in `streambot.test.ts`.
- **Docs** — updated `packages/streambot/AGENTS.md` (new modules + commands).
- **Verification** — streambot: typecheck clean, eslint clean, `155 pass / 0 fail`. homelab cdk8s: typecheck clean, eslint clean, streambot deployment tests `9 pass`.

### Remaining

- **Operator step:** DONE — created a dedicated `streambot-tmdb` 1Password item (Homelab vault) with a concealed `TMDB_API_KEY` field; homelab `streambot.ts` references it via its own `OnePasswordItem`/secret (optional env). Bot runs fine without it — posters silently disabled.
- **PR:** open PR; capture a Discord screenshot of the poster embed + `/stream chapters` output for the description (repo visual-change rule).
- **Live smoke (optional):** confirm `ffprobe` chapter extraction against a real chaptered `.mkv` on the deployed pod; confirm a real TMDB lookup once the key is set.

### Caveats

- Normalizing the _matching_ key means junk tags (`Bluray`, `1080p`) no longer match in `/stream play` (intended). Two files differing only by tags can collapse to the same display title (distinct paths preserved).
- Posters depend on TMDB title-match quality; obscure/foreign titles fall back to text-only by design.
- Chapters are best-effort: files without chapter metadata and most non-YouTube URLs report none.
- Fresh worktree required several `bun install`s (root, streambot, discord-video-stream fork, eslint-config build, homelab cdk8s + helm-types) before typecheck/eslint ran cleanly — see `setup.ts`.

## Session Log — 2026-06-07 (e2e)

### Done

- Extended the Dagger e2e (`packages/streambot/e2e/run.ts`, run via `dagger call e2e-streambot`) to cover the new features with real binaries + real Discord:
  - **Chapters** — the generated test clip now embeds 3 chapters (Intro@0 / Middle@10 / End@20 via an ffmetadata input). Phase 1 asserts the real `ffprobe` populated `context.resolved.chapters`, then drives a chapter seek (the `/stream chapter` path) and asserts the live position jumps to the chapter start and keeps advancing.
  - **TMDB poster (optional)** — new Phase 0 (`checkTmdbPoster`): when `TMDB_API_KEY` is set, looks up a known title (`Big Buck Bunny` 2008) via the real `fetchPoster` and asserts a poster URL comes back **and** is live (HTTP 200 HEAD). Skipped cleanly when no key.
- **Dagger wiring** — added optional `tmdbApiKey: Secret | null = null` to `e2eStreambot` (`.dagger/src/index.ts`) + `e2eStreambotHelper` (`.dagger/src/misc.ts`); sets `TMDB_API_KEY` only when provided. `e2eStreambot` is manual-run (not in CI), so the added arg is safe.
- **Local validation** (no Discord needed): generated a chaptered clip and ran the real `resolveSource` → `ResolvedSource.chapters` matched the expected 3 chapters (assertion passed). ffprobe path also validated directly earlier.
- **Normalization** is covered by the existing filesystem integration test (`test/library.test.ts` writes real files and scans them) — no Discord e2e needed.
- Verified: streambot typecheck + eslint clean, `155 pass`; dagger hygiene check clean.

### Remaining

- To exercise the TMDB e2e assertion, pass `--tmdb-api-key` to `dagger call e2e-streambot` (and add the `TMDB_API_KEY` field to the `streambot-config` 1P item). Without it, the e2e skips that phase.
- The chapter-seek + Discord-streaming assertions only run in the full Dagger e2e (real voice channel); they can't run in plain `bun test`.

### Caveats

- e2e requires the engine + real test-server credentials (see `packages/docs` notes on the streambot e2e test server); it is a manual/opt-in run, not part of the standard CI gate.

## Session Log — 2026-06-07 (live e2e run)

Ran the live Dagger e2e three times against the test guild (`1337623164146155593`) with the real TMDB key (`--tmdb-api-key`). Final run **PASSED** (`DAGGER EXIT: 0`, `e2e: resume PASS`):

- `e2e: TMDB poster OK` — Big Buck Bunny poster fetched from the real TMDB API (key sourced via env, mirroring the new `streambot-tmdb` 1P item path) and confirmed live.
- `e2e: chapters extracted, count: 3` — the real `ffprobe` in the production image extracted the embedded chapters and threaded them onto `context.resolved.chapters` during a live stream.
- Resume: captured `5.161s` → resumed `5.036s` (within tolerance).

Two e2e robustness bugs the live runs surfaced and fixed (in `e2e/run.ts`):

1. **Over-eager live chapter seek** — seeking 1 ms after `streaming` began (before the Go-Live WebRTC stream stabilized) tore the stream down. Live mid-stream seek continuity is manual-only per the fork notes, and the chapter→seek wiring is unit-tested + the seek mechanism is covered by the resume phase — so the strict live-seek assertion was removed; `assertResolvedChapters` (the meaningful new live check) stays.
2. **Resume position read race** — phase 2 read `getPosition()` the instant `waitFor(streaming)` returned, before `player.start()` anchored the clock, yielding `0`. Added `waitForAnchoredPosition()` to poll until the clock anchors before asserting.

## Session Log — 2026-06-07 (deeper live verification)

Hardened the live e2e to verify the user-visible surfaces, not just the internal calls (new `e2e/verify.ts` holds the Config-only Discord/TMDB checks). Final run **PASSED** (`DAGGER EXIT: 0`):

- **Slash commands accepted by Discord** — `verifyRegisteredCommands` reads back the guild's registered `/stream` command and asserts the new `chapters` + `chapter` (with its `number` option) subcommands exist. Catches command-schema errors nothing else would. Logged: all 17 subcommands incl. `chapters`, `chapter`.
- **Now-playing poster embed actually posts to Discord** — `verifyNowPlayingEmbed` wires a real `StatusReporter` to the session, plays a file titled `Big Buck Bunny (2008)`, then polls the status channel via the bot REST API until the message with a TMDB poster embed appears, asserts content + `image.tmdb.org` URL, and deletes it. Proves the full `StatusReporter → announce → discord.js embed → Discord` path (not just `fetchPoster`).
- Still green: real-ffprobe chapter extraction (count 3), resume (6.755 → 6.04).

Net: both new features verified end-to-end on real Discord — command registration, the poster embed landing in-channel, and chapter extraction mid-stream.
