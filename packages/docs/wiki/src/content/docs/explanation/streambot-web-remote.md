---
title: Streambot web remote
description: Why Streambot's browser remote shares Discord identity and the existing playback actor.
---

The browser controls the voice channel's existing Streambot session while media continues playing in Discord.

The web API lives in the same Bun process as the command bot.
It calls the shared playback service rather than introducing a second queue or streaming connection.
The [playback service](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/commands/playback-command-service.ts)
remains responsible for media selection, source blocking, and request history.
The [session manager](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/session/session-manager.ts)
acquires a userbot only when playback begins.
Browsing alone does not consume one.

## Identity follows the viewer

Discord OAuth establishes the viewer's identity and shared servers.
The [Discord context](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/discord/web-context.ts)
shares an in-flight membership lookup between concurrent media requests.
Later requests check membership again, without relying on privileged gateway events to revoke cached access.
Every playback action uses the viewer's current voice channel from the bot's gateway state.
Client-supplied user identities cannot authorize an action.

The web remote gives everyone currently in that voice channel shared control.
Its authorization adapter retains the real requester when adding media.
Channel 1 plays mic audio; channel 2 and higher play Go Live video.
Each slot keeps its own player and queue. Inspecting one does not acquire a userbot.
Existing slash, card, and voice permissions retain their defaults in
the [shared controls](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/commands/playback-controls.ts).

## The viewer chooses Listen or Watch

Whether media plays as audio or as a stream is the viewer's choice, made on each play request.
Listen is voice audio that everyone in the channel hears. Watch is a Go Live stream that people open.
Server-side `Auto` guessed the transport from metadata, so a viewer could not predict where a click would land.
Naming the transport makes the button the destination.

The [web playback adapter](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/playback.ts)
sends Listen to channel 1 and Watch to channel 2, or to a further slot when the viewer starts another stream.
These requests bypass the personal channel selection and `Auto`, and never move that selection.
The selection is shared with Discord commands, so a web click should not redirect someone's next `/play`.
The response names the transport and the viewer's voice channel, so the page can say where the media went.
Only the requesting viewer receives that channel name; logs and metrics record the transport alone.

A request is refused when its transport cannot be honoured, rather than quietly played the other way.
Watch is refused when [resolution](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/sources/resolve.ts)
probes the media and ffprobe finds no picture.
yt-dlp metadata reports missing video inconsistently, so only the probe decides.
Listen is refused for live sports and wherever music over voice is disabled.
A legacy room has one mixed queue, so there Listen and Watch become the item's mode; only an extra stream is refused.

Requests that name no transport keep the older routing, because Discord commands and the classic page still send them.
The [snapshot selector](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/snapshot.ts)
combines `Auto` with numbered channels for those requests, so the displayed queue and their destination match.
Legacy mixed queues keep their existing behavior until they finish.

## A page can become stale

Only an action that names a queue position depends on the state the viewer saw.
Remove, move, replacing a queued recording, and subtitle choices carry the session revision.
The [web playback adapter](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/playback.ts)
refuses them with a refreshable conflict when the revision changed.
After a shuffle, position 3 is a different item, so acting on it would edit something the viewer never chose.

Every other action applies to the current state when it lands.
That covers adding to the queue, playing next or now, volume, loop, pause, skip, stop, clear, shuffle, and stations.
The revision changes on every actor event, including a track starting.
Binding these actions to it refused clicks that meant the same thing a moment later.
The same rule holds after slow media resolution: a queue addition lands behind whatever arrived meanwhile.
The [playback machine](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/machine/playback-machine.ts)
appends, prepends, or replaces the current item for these events without reading any viewer-supplied position.

Pause, resume, skip, and seek still act on one particular item.
A client may send that item's opaque token, and the server refuses the action if a different item now plays.
Tokens are random per queue entry and reveal no path or URL.
The [session observer](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/session/session-observer.ts)
carries a token across re-resolution and crash retries, so one request keeps one token until it finishes.
Two requests for the same media get different tokens, so a stale skip cannot skip a repeat.

The voice channel is rechecked before every dispatch.
Requests without a transport also recheck the personal selection, because it chose their destination.

Subtitle choices refer to tracks actually enumerated from the current source.
They expire and are bound to the viewer, source, and revision.
Choosing one restarts playback at the current position.
The browser receives opaque references rather than local paths or ffmpeg inputs.

## Discovery shares media metadata

Library, queue, and player images use TMDB posters with the existing server-side credential.
Episodes use their series poster. Lookups are lazy and shared per title, so artwork
does not delay browsing or playback. YouTube search results carry their provider thumbnails.
Only supported public image CDNs can reach the browser; local paths and credentials stay on the server.
TMDB attribution appears in the remote's artwork credits.

The Live sports tab combines StreamEast, TVSportsLive, and official LoL Esports listings.
Its event selections are short-lived and bound to the viewer.
Upcoming games remain visible but cannot be queued. Live selections enter the shared
playback service, which checks the sports gate and resolves the provider's stream.
Queued sports retain the stable event page so playback can refresh expiring stream URLs.
Live sports retain their existing playback control restrictions.

## Scheduled series keep a separate owner

LoL schedules identify a series rather than a broadcast channel, because one channel can carry several consecutive matches.
The [sports catalog](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/sports/sports-service.ts)
refreshes official event metadata before resolving English YouTube or Twitch playback.
Temporary media URLs remain outside persisted history.

Scheduling records the requester's current voice channel and video slot, so later personal channel selections cannot redirect it.
Temporal drives reconciliation through an authenticated internal listener; process restarts do not lose the user's intent.
The [application wiring](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/index.ts) joins that listener to the existing session manager.
Playback requires listeners, permissions, an idle slot, and an available userbot.
Each automatic play carries an ownership identifier that survives session recovery but is removed from history replays.
Completion and cancellation act only on that owned item, preserving replacement playback and other queues.

See [scheduled playback activation](/how-to/enable-streambot-lol-scheduling/) for the operator procedure.

## Music separates catalog identity from playback

MusicBrainz identifies artists, album editions, and recordings without requiring a listener's streaming-service account.
The [catalog](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/catalog.ts)
provides those entities; the [Streambot service](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/index.ts)
searches YouTube for playback sources. The [matcher](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/matching.ts)
uses artist, title, version, and duration to rank recordings.
The [web recording picker](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/music.ts)
lets listeners correct a queued or saved song.
Saved sources retain catalog identity alongside the selected video, so [voice recovery](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/session/voice-recovery.ts)
can resolve a fresh audio URL. The [artwork resolver](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/artwork.ts)
keeps album artwork with saved playlists, queues, recovery, and player cards.
MusicBrainz covers come from the Cover Art Archive, and [Spotify links](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/spotify.ts)
retain their public album cover. Saved playlist covers represent their first track.

`/play` and `!play` accept a title or supported link and share playback routing and playlist loading.
The [message shortcut](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/discord/quick-play.ts)
uses Discord's Message Content Intent, and [intent setup](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/discord/command-intents.ts)
checks the application's granted capability before requesting it at login.
The slash command remains available when message content is unavailable.

Playing an external playlist link expands temporary metadata directly into an active room queue.
Importing a YouTube or public Spotify link through
[playlist import](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/playlist-import.ts)
snapshots tracks into a saved collection without starting a voice session.
Saved playlists keep a separate lifetime in the
[playlist store](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/playlists.ts)
and [history database](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/history/media-history.ts).
Private ownership and server sharing keep personal collections separate from a room's active queue.
Sharing grants playback and copying while keeping edits with the owner.
The [web playlist API](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/music-playlists.ts)
rechecks server membership and playlist access when a saved selection is used.
Making a playlist private revokes its previously issued selection tokens.

## Continuous stations stay outside the state machine

Radio and TV stations belong to the
[session manager](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/session/session-manager.ts)
rather than the
[playback machine](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/machine/playback-machine.ts).
The state machine stays deterministic so tests and voice harnesses can drive transitions without gateways, network calls, or SQLite reads.
Station curation needs external I/O across
[media history](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/history/media-history.ts),
[saved playlists](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/playlists.ts),
[Plex metadata](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/metadata/plex.ts),
and YouTube search.

The session layer therefore feeds a small bounded lookahead into the ordinary playback queue.
Keeping only a couple of items ahead preserves gapless transitions without locking in stale picks when listeners change or skip.
Explicit listener queue additions naturally raise the queue above that low-water mark and pause station refill.
Human requests play uninterrupted first, and continuous curation resumes only after the queue drains back down.

## The edge serves the remote

The frontend is built into the Streambot image.
When activated, the media namespace exposes a separate web Service through the shared Cloudflare tunnel.
The tunnel binding and DNS record arrive together with OAuth activation.
Metrics remain on their own internal Service in the
[Streambot deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/streambot/streambot.ts).
Credential bootstrap is deliberate so missing OAuth credentials cannot break an existing Discord-only deployment.

See [activation](/how-to/enable-streambot-web-remote/) for the operator workflow and
[playback transports](/explanation/streambot-transports/) for how Discord receives the media.
