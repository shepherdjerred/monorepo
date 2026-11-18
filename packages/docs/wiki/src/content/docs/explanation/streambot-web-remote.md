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
Splitting viewed slot and target slot let play actions land in a different queue than the viewer inspected.
One [snapshot selector](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/snapshot.ts)
combines `Auto` with numbered channels so the displayed queue and manual actions always match.
`Auto` follows an occupied slot first, while numbered choices share personal focus with Discord commands.
Channel 1 plays mic audio; channel 2 and higher play Go Live video.
Each slot keeps its own player and queue. Selecting one does not acquire a userbot.
Legacy mixed queues keep their existing behavior until they finish.
Existing slash, card, and voice permissions retain their defaults in
the [shared controls](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/commands/playback-controls.ts).

## A page can become stale

A queue position has meaning only within the session revision the viewer saw.
Actions include that revision, the voice-channel identity, and the selected playback slot.
The server rechecks them after asynchronous media resolution and before dispatch.
A changed queue, voice channel, or personal selection produces a refreshable conflict instead of controlling a different item.

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
