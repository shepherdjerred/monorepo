# streambot

Discord media orchestrator: streams local media files and yt-dlp/URL sources
into Discord voice channels, controlled through `/stream` commands, the voice
assistant, player cards, or an authenticated web remote. Music plays as audio over the voice connection; video plays as a
Go Live stream. One Bun process serves many servers — and many voice channels
per server — concurrently.

Media requests default to a federated history, local-library, and YouTube
search. Character renditions such as “Beggin by Plankton” also search explicit
AI-cover spellings. Ambiguous results become numbered follow-ups instead of
silently playing a weak match. `/stream playback join` starts an idle listening session;
the same speaker may answer a clarification twice without repeating the wake
phrase.

## Numbered playback channels

When the guild's numbered-channel beta is enabled, `/stream select channel:1`
selects mic audio (the default). `/stream select channel:2` selects Go Live
video on the **same userbot**. Channels 3 and higher use additional userbots.
These numbers are playback slots inside your current Discord voice channel.
Selection allocates no account and is personal to you; it resets when you
leave the voice channel or Streambot restarts. `/stream channels` lists the
slots, your selection, current items, and queue lengths.

For music alongside a movie, queue music on 1, select 2, then queue the movie.
For another movie in that voice channel, select 3. A YouTube video queued on
1 plays audio only. Sports and subtitles require selecting 2 or higher.
Playback, queue, volume, and seek commands target your selected slot; player
card buttons target the exact playback instance shown on that card.
`/stream stop` stops one slot. `/stream playback leave` stops the entire room
and requires an admin. `/stream playback chapters` lists chapter markers.

The default-off `streambot-numbered-channels-enabled` flag targets guilds and
is latched for an active room. It overrides the older music transport gate.
Existing mixed queues finish under the legacy model before numbered playback
can start. Account availability is shared globally, so an idle slot does not
guarantee a free account. Each video retains its own soundtrack; only channel
1 writes media to the mic. StreamEast remains a video source in this model.

## How it works

Discord bots cannot stream video into voice; only user accounts can. Streambot
therefore splits identities:

- **Command bot** (`discord.js`, bot token) — the ToS-clean control plane:
  registers global slash commands, routes each interaction to the right
  session, renders the status/queue player card.
- **Userbot pool** (`discord.js-selfbot-v13`, `USER_TOKENS`) — N streaming
  accounts. A play acquires a free userbot that is a member of the requesting
  guild; account leases remain exclusive across voice channels and guilds.
- **Rooms and sessions** — a room coordinator owns one XState v5 actor per
  numbered playback slot, each with its own queue, loop, volume, and clock.
  Slots 1+2 share a connection lease, and only one assistant listens per room.
  A versioned atomic room snapshot restores every slot across restarts.
- **Media history** — `/state/streambot.sqlite` records queue requests and
  playback starts for one year. Discovery combines the requesting user's
  cross-server history with the current guild's history. Favorites and saved
  queues remain until explicitly removed. Raw audio and transcripts never
  enter this database.
- **Web remote** — a React client served by the same Bun process. Discord OAuth
  establishes identity; live guild membership and voice state authorize each
  media request. Everyone currently in the channel can control playback through
  the web remote. Slash, voice, and card permissions keep their existing policy.
  The destination selector shares the viewer's personal numbered channel with Discord
  commands. With `streambot-automatic-channel-routing-enabled`, music defaults to 1;
  Plex, sports, and other video default to 2 across web, slash, and voice commands.
  Manual selection wins until the viewer chooses Auto or `/stream select auto:true`.
  Each slot retains its own queue, and legacy sessions finish in their original mode.
  The URL's `channel` chooses the slot being viewed without changing that destination.
  `/plex`, `/search`, `/sports`, and `/history` preserve submitted searches, filters,
  series, pagination, and server context in URLs. Deep links survive OAuth sign-in;
  browser Back/Forward restores the page and its scroll position.
  Media paths and subtitle references stay on the server behind opaque IDs.
  The Plex poster rollout gives Plex a movie/show poster grid. A show opens
  season-grouped episodes; queue, player, and search retain compact artwork.
  Local media uses the selected Plex movie or series poster, matched by exact
  media file path. Missing Plex artwork keeps a placeholder without a TMDB lookup.
  `streambot-plex-posters-enabled` controls this per user/server; disabling it
  restores the existing rows and TMDB artwork. Plex images are served through
  the authenticated Streambot endpoint; its token and internal URLs stay on the server.
  Metadata refreshes lazily after five minutes and never delays browsing or playback.
  `PLEX_BASE_URL` and `PLEX_TOKEN` are optional bootstrap and must be supplied together.
  StreamEast artwork uses the provider's public team and league logos; missing art
  has a generic matchup card. YouTube flat search metadata supplies thumbnails.
  Queue entries retain their requester and enqueue time across reorder and restart,
  including when history is disabled; older entries may have an unknown enqueue time.
  History has separate Mine (all this user's plays) and Server views, 50 runs per page,
  source and title filters, and the existing one-year retention. Repeated plays remain
  individual runs. Sports remain visible after ending, but replay checks today's event
  identity again before allocating playback. The SQLite upgrade preserves favorites
  and saved queues. Help, eligible play tips, and player cards link to the web remote.
  Production reuses the existing Plex service and 1Password-backed token. YouTube
  discovery shows its real thumbnails. Poster lookup is lazy and does not hold
  up library browsing or playback. The Live sports tab searches today's
  StreamEast and TVSportsLive events and offers queue, play-next, and play-now.
  Selecting one provider fetches only that provider; All sports providers combines
  available listings. Slow requests stop with a retry message rather than leaving
  the tab loading indefinitely.
  Upcoming events cannot be queued; the existing sports gate and control
  restrictions apply.
- **Transports** — the userbot emits media two ways. Numbered slots fix the
  transport; legacy queues choose per item. Music
  plays as microphone audio over the ordinary voice connection (`speaking: 1`,
  a green ring); video plays as a Go Live stream. Both share the one voice
  connection, allowing mic audio and Go Live concurrently. A single mixer owns every outbound audio frame, because
  the assistant speaks over that same connection and two Opus writers on one
  RTP timestamp interleave into noise rather than mixing. Which one an item is
  is forced by selection in numbered rooms. Legacy requests use metadata,
  ffprobe, and `mode:`. ffprobe still rejects video requests without a picture.
  See the
  [transports explanation](../docs/wiki/src/content/docs/explanation/streambot-transports.md).
- **Streamer** — ffmpeg-driven voice streaming via
  [`@shepherdjerred/discord-video-stream`](../discord-video-stream/), the
  in-repo fork of `@dank074/discord-video-stream` (seekable player, VAAPI
  hardware-encode pipeline, stream observer for metrics).

The playback lifecycle is a pure, unit-tested XState machine; all I/O lives in
invoked actors. `yt-dlp` and `ffmpeg` are system binaries baked into the
Docker image. Prometheus metrics are served on `/metrics` (default port 9466);
the headline signal is `streambot_ffmpeg_speed_ratio`.

## Web development

Run `bun run build` before starting a process with web credentials. The production
server serves `dist/web` on the credential bootstrap port, separate from metrics.
For frontend iteration, `bun run web:dev` proxies API requests to that server.

`bun run e2e/web-local.ts` serves a credential-free acceptance fixture on
`http://127.0.0.1:8080`. Its sign-in simulates Discord and its media I/O is simulated;
the routes, session storage, command service, and playback actor are real. This
fixture is absent from the production image. Use it after `bun run build` to inspect
the library, queue, controls, subtitle picker, and system light/dark themes.

The expanded browsing fixture is `bun run test/web/preview.ts` on port 5188 after
`bun run build`; it includes simulated OAuth, sports artwork, history, and attribution.

| Bootstrap               | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `WEB_PUBLIC_ORIGIN`     | Exact HTTPS origin, or HTTP localhost for development |
| `DISCORD_CLIENT_SECRET` | Existing command application's OAuth client secret    |
| `WEB_PORT`              | Optional listen port; defaults to `8080`              |

Omitting both origin and secret leaves the web listener absent. Supplying only one
fails startup. OAuth uses `identify guilds` with a callback at
`<WEB_PUBLIC_ORIGIN>/api/auth/discord/callback`. Hashed sessions persist for seven
days in `/state/streambot-web.sqlite`; OAuth access tokens are not persisted.
Media API access uses the default-off `streambot-web-ui-enabled` per-server/user
gate. Pause, resume, and play-now also respect the existing assistant gate.
See the [web remote explanation](../docs/wiki/src/content/docs/explanation/streambot-web-remote.md)
and [activation guide](../docs/wiki/src/content/docs/how-to/enable-streambot-web-remote.md).

The assistant adds pause, resume, restart, previous, play-now, richer subtitle
selection, favorites, saved queues, “my usual,” and local-series continuation.
The matching slash groups are `/stream playback`, `/stream history`, and
`/stream personal`. Assistant V2 and durable history are independently guarded
by typed Flipt flags and default off outside their rollout targets.

Sports listings and live sports playback are a separate, default-off Flipt
feature. `/stream playback sports` shows today's games in a paginated Discord
embed with live, unconfirmed, and upcoming status. Its private dropdown queues
a live or unconfirmed game in your current voice channel, checking availability
and the sports feature gate again when selected. Browsing does not reserve a
stream bot, and the picker expires after two minutes. Voice can list games on
request, and a game title tries StreamEast before TVSportsLive
unless a provider is named. Listings keep games returned before the request
deadline even when the other provider times out; a timeout with no games still
reports an error. Future events are informational and are never
queued; TVSportsLive posts without a kickoff time are marked unconfirmed and
validated when selected. Playback uses the stable provider page as the source
identity and resolves the live HLS input at play time through PinchTab. The
resolver opens the approved embedded player, captures its successful HLS request,
and has ffprobe select a rendition with real video dimensions and audio before
FFmpeg sends it to Discord. HLS URLs are not written to media history. Live sports
offer play, skip/stop, and volume controls only. The bot needs PinchTab's
`PINCHTAB_BASE_URL` and `PINCHTAB_TOKEN`; the homelab deployment supplies the
service address and the shared 1Password-backed token. See
[`sports-service.ts`](src/sports/sports-service.ts) for matching,
[`sports-resolver.ts`](src/sports/sports-resolver.ts) for runtime resolution,
and the [managed flag inventory](../feature-flags/FLAG-INVENTORY.md) for rollout
scope.

Active playback sessions also expose an end-to-end voice diagnostic path. Each
wake candidate owns one correlated trace from Discord receive and local
verification through OpenAI, tool execution, reply drain, and terminal
outcome. Structured stdout logs carry the active trace and span IDs and are
also exported to Loki; controlled spans are exported to Tempo. The OpenAI SDK's
own tracing remains disabled.

When private capture storage is enabled, every wake candidate queues either its
local-verifier window or its full accepted utterance as 16 kHz mono WAV. An
admin in an active playback session can also capture the exact decoded input
that reached the wake detector:

```text
/stream voice-debug start [duration]  # default 60 seconds; 10–300
/stream voice-debug status
/stream voice-debug stop
```

Captures live in the private `streambot-voice-captures` bucket for 90 days.
Audio objects upload first and `manifest.json` uploads last as the commit
marker. Capture or telemetry outages never delay or fail a voice command;
invalid required startup configuration still fails fast. See the
[voice reference](../docs/wiki/src/content/docs/reference/streambot-voice.md)
and the
[diagnostic how-to](../docs/wiki/src/content/docs/how-to/diagnose-streambot-voice.md).

This package is a ground-up rewrite behaviorally inspired by
`ysdragon/StreamBot` — no upstream source is copied. [FORK.md](FORK.md)
documents the attribution and the deliberate divergences (state machine over
mutable flags, bot/userbot split, no web UI, branded types, VAAPI encoding).

## Commands

```bash
bun run dev              # watch mode
bun run start            # run once
bun run test             # unit tests (machine, config, sources) — no ffmpeg needed
bun run test:integration # real-ffmpeg subtitle tests (needs ffmpeg + libass)
bun run e2e              # live e2e against the dedicated test Discord server
bun run e2e:sports       # manual live sports browser → Discord Go Live check
bun run e2e:voice-recovery # live voice-loss recovery e2e
bun run typecheck
bun run lint
bun run docker:build     # build the image (repo-root build context)
bun run smoke            # smoke script
```

The live e2e runs need real tokens and test-guild IDs via environment.
`e2e:sports` additionally needs `E2E_SPORTS_URL`, `PINCHTAB_BASE_URL`, and
`PINCHTAB_TOKEN`; `E2E_PINCHTAB_PROFILE` can isolate local browser state. Run it
against an empty voice channel while that event's HLS
stream is available. It checks browser discovery, ffprobe, and actual Discord
audio/video sends, then leaves the channel. See
[AGENTS.md](AGENTS.md) for the small set of always-on package constraints and
the linked wiki pages above for voice architecture and diagnostics.
