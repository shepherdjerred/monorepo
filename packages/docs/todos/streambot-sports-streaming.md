---
id: streambot-sports-streaming
status: deferred
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Streambot: support streaming sports

## What

Add the ability to find and stream live sports events. Streambot's content
sources are currently a 3-way discriminated union (`file` / `url` / `search`),
all resolved through system `yt-dlp` — there is no sports/live-event provider.

Source abstraction:

- `packages/streambot/src/sources/source.ts:15-38` — the `Source` union.
- `packages/streambot/src/sources/resolve.ts` — resolution (`url` + `search` go
  through `resolveWithYtdlp`).
- `packages/streambot/src/sources/ytdlp.ts` — maps a source to a yt-dlp target.
- `packages/streambot/src/sources/library.ts` — local-file library scan.

## Why it's deferred

This is net-new: a sports source requires live-event discovery (provider APIs,
not yt-dlp passthrough), live-status metadata (teams, score, live/over), and
new ranking/search to surface current events. None of that exists.

## Done when

- A new source kind / provider lets a user find and stream a live sports event,
  with status embeds reflecting live state.
