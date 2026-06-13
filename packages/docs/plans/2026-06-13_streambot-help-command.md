# Streambot — `/stream help` command + document supported sources

## Status

Complete

## Context

streambot (`packages/streambot`) had no in-Discord way to discover its commands or learn what's
streamable. This adds a `/stream help` subcommand and answers "what sources do we support?"

**Source model** (`src/sources/source.ts`, `src/discord/resolve.ts`): a `/stream play <query>`
resolves to one of three kinds — `file` (local library title), `url` (any `http(s)` link, passed
verbatim to yt-dlp), or `search` (`ytsearch1:<query>`). Playlist URLs auto-expand. The only filter
is an adult-content blocklist (`src/moderation/adult-block.ts`).

**Auth reality — "public/anonymous yt-dlp," not "all ~1800 sites":** streambot invokes `yt-dlp` with
a fixed, fully-anonymous arg set (`buildInfoArgs`, `expandPlaylist` in `src/sources/ytdlp.ts`):
`--dump-single-json --no-playlist --no-warnings --no-progress --skip-download -f best`. No
`--cookies`/`--cookies-from-browser`/`--username`/`--password`/`--netrc`/`--proxy`/`--extractor-args`
anywhere, and `src/config/schema.ts` has no field for any of them. So:

- **Works:** direct `.mp4`/HLS/DASH, public YouTube/Vimeo/Twitch, SoundCloud, Bandcamp, archive.org,
  Reddit, most public video sites.
- **Doesn't:** DRM/subscription (Netflix, Disney+, Max, Spotify — yt-dlp can't, DRM); login/
  members-only/age-gated (private YouTube, Patreon, Nebula, Crunchyroll); increasingly cookie-gated
  "public" sites (Instagram, TikTok, X, Facebook).
- **Flake:** YouTube intermittently demands a bot-check from datacenter IPs (no cookies/PO-token).

Wiring an optional cookies-file / credentials config is a separate, larger follow-up — out of scope.

## Changes

| File                             | Change                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/discord/commands.ts`        | Register `help` subcommand (no options) under `/stream`.                                                                                                                |
| `src/discord/command-handler.ts` | `case "help"` → `interaction.reply(helpText())`; new exported pure `helpText()` (grouped reference + supported-sources note, ~1.1k chars, < 2000 limit).                |
| `test/command-handler.test.ts`   | Content test (anchors `/stream play`, `Supported sources`, `yt-dlp`, ≤2000 chars) + **drift guard** asserting every registered subcommand name appears in `helpText()`. |
| `AGENTS.md` (streambot)          | One line noting `/stream help` + the drift-guard test.                                                                                                                  |

`helpText()` is a standalone exported pure function (not a `CommandHandler` method) so the drift
guard can call it without instantiating the handler — preserving the existing discord.js-free,
unit-testable design.

## Verification (done)

- `bun test test/command-handler.test.ts` → 32 pass (2 new).
- `bun run typecheck` → clean (after building the `discord-video-stream` dist + copying it into
  streambot's `node_modules` copy — fresh-worktree artifact, see `reference_dvs_dist_node_modules_stale`).
- `bunx eslint src/discord/commands.ts src/discord/command-handler.ts test/command-handler.test.ts` → clean.
- Rendered `helpText()` manually: 1102 chars.

Manual (optional, post-deploy): run `/stream help` in the command channel; the ephemeral reference
should list every subcommand. Slash commands register on `ready`, so it appears immediately.

## Session Log — 2026-06-13

### Done

- Added `/stream help` (`packages/streambot/src/discord/commands.ts`, `command-handler.ts`) with an
  exported pure `helpText()` builder.
- Added a content test + subcommand drift-guard in `test/command-handler.test.ts` (32 pass).
- Documented `/stream help` in streambot `AGENTS.md`.
- Verified: typecheck clean, eslint clean, help renders at 1102 chars.

### Remaining

- None for the requested scope. Optional follow-up (not requested): add a cookies-file/credentials
  config so login/age-gated yt-dlp sources work.

### Caveats

- Fresh worktrees: streambot typecheck surfaces `discord-video-stream/src` strict errors until you
  `bun run build` the dvs package and copy its `dist` into
  `packages/streambot/node_modules/@shepherdjerred/discord-video-stream/dist`
  (see `reference_dvs_dist_node_modules_stale`). Not a code issue; CI/main have the dist built.
- `helpText()` must stay < 2000 chars; the drift-guard test requires the footer to list `/stream help`.
