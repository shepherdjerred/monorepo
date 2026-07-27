---
id: streambot-sports-streaming
type: todo
status: planned
board: true
verification: agent
disposition: deferred
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

## Remaining

- [ ] Select and document a legal, reliable live-sports discovery/playback provider with acceptable authentication, terms, and event coverage.
- [ ] Define event identity, search/ranking, live/upcoming/finished status, and failure semantics independently of yt-dlp URL search.
- [ ] After those decisions, add a typed sports source/provider, live-status embeds, tests, and operational observability.
- [ ] Verify discovery and playback against provider fixtures plus an authorized live event.

## Comment Log

- 2026-07-27 — Board audit confirmed `Source` remains a `file`/`url`/`search`
  union and no sports provider exists. The feature cannot be implemented
  responsibly until provider legality, API access, and event semantics are
  selected, so it remains deferred.
