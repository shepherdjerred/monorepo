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

## The room is found from voice state

A viewer who has to say which server and which voice channel they mean can say the wrong one.
The remote therefore never asks.
The room endpoint scans the voice states the gateway already caches in the
[Discord context](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/discord/web-context.ts)
across the servers the viewer shares with Streambot, and treats the channel that holds them as where they are.
A server whose web remote is off, or that no longer has the viewer as a member, is skipped as if the viewer were not there.
The search runs on the server for every snapshot, so it cannot be redirected by anything the client sends.

Discord connects a member to one voice channel at a time.
A second match can only mean a stale cache entry, so the lowest server id wins.
That rule gives the same answer on every request, where OAuth guild order would change with the sign-in.

A `guildId` query is honoured only when the viewer is in no voice channel.
Browsing then needs some server to evaluate feature gates against, and the viewer may pick one.
An in-voice viewer's room is never moved by it, because a client-chosen server would let a request read another room's queue.

One response carries every player in the room: the Listen slot and each Watch stream, with the viewer's gates beside them.
Putting the gates in the same response keeps the page from offering a button that will answer 403.
A legacy room has a single mixed queue, so it is reported as one player whose transport follows its current item, and an idle one has no player.

## State is pushed, not polled

A page that asks for state every two seconds is always partly wrong and mostly asking nothing new.
The room stream sends a full snapshot when a viewer connects and another whenever the room changes.

A change is something that already happens in the process.
The [session factory](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/session/create-session.ts)
already subscribes to each playback actor, so the same subscription also tells a small change hub.
A slot appearing or ending, a station starting or stopping, and the viewer joining, leaving or moving in the
[gateway handler](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/discord/commands/command-bot.ts)
reach it too.
Some changes produce no actor event, so the session reports them itself.
A successful seek or chapter jump moves the position without one, and a streamer dragged to another channel leaves a room as well as entering one, so both rooms hear about it.
A stream subscribes before it reads its first snapshot and replays what arrived meanwhile, so a change during the connect is not lost.
The hub names where something changed and never what, so each stream re-reads the authoritative state and no second copy can disagree with it.
Streams ignore changes in other rooms and other members' voice moves.

A stream holds one unsent snapshot at most.
A burst of changes becomes one rebuild, and a client that has not read its last frame gets the newest state when it does, not a backlog of stale ones.
Memory per connection is therefore one frame, regardless of how slow the client or how busy the room.
After a reconnect the client receives a fresh full snapshot, so there is no replay log to keep consistent.

Every rebuild authorizes again, so a removed member or a server that switches the remote off ends the stream with a terminal error event rather than at the next poll.
A stream also checks the sign-in on each keepalive, which is how a sign-out from another tab is noticed within seconds.

The keepalive exists because the
[server's idle timeout](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/start.ts)
is shorter than a quiet room, and the public path crosses a Cloudflare tunnel that also closes idle responses.
It belongs to the connection and ends with it, so it is not scheduled work.
Streams are capped per sign-in and per process, so a runaway client cannot hold the process's sockets.
The request that opens a stream finishes when the stream starts; its span, duration metric and rate-limit count describe the connect, and a separate gauge and histogram describe the stream's lifetime.

## The viewer chooses Listen or Watch

Whether media plays as audio or as a stream is the viewer's choice, made on each play request.
Listen is voice audio that everyone in the channel hears. Watch is a Go Live stream that people open.
A server that guessed the transport from metadata would leave the viewer unable to predict where a click lands.
Naming the transport makes the button the destination.

The [web playback adapter](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/playback.ts)
sends Listen to channel 1 and Watch to channel 2, or to a further slot when the viewer starts another stream.
Every other command names the slot of the player card it came from, and the
[command targeting](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/command/targeting.ts)
resolves a command that names none to the slot its action implies: Radio on 1, TV on 2.
Discord commands route automatically and keep a personal numbered-channel selection per member.
The web reads neither and never moves that selection, so a web click cannot redirect someone's next `/play`.
The response names the transport and the viewer's voice channel, so the page can say where the media went.
Only the requesting viewer receives that channel name; logs and metrics record the transport alone.

A request is refused when its transport cannot be honoured, rather than quietly played the other way.
Watch is refused when [resolution](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/sources/resolve.ts)
probes the media and ffprobe finds no picture.
yt-dlp metadata reports missing video inconsistently, so only the probe decides.
Listen is refused for live sports and wherever music over voice is disabled.
A legacy room has one mixed queue, so there Listen and Watch become the item's mode; only an extra stream is refused.
Legacy mixed queues keep their behavior until they finish.

## A page can become stale

Only an action that names a queue position depends on the state the viewer saw.
Remove, move, and subtitle choices carry the session revision.
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

The voice channel is rechecked before every dispatch, so a command from a viewer who has since moved is refused rather than played into a room they left.

Subtitle choices refer to tracks actually enumerated from the current source.
They expire and are bound to the viewer, source, and revision.
Choosing one restarts playback at the current position.
The browser receives opaque references rather than local paths or ffmpeg inputs.

## The page is one search box and a rail

The remote is organized around what the viewer wants to do, not around which backend answers.
A page organized by provider makes the viewer know where something lives before they can find it.
The [browser client](https://github.com/shepherdjerred/monorepo/tree/main/packages/streambot/src/web/client)
has one search input in the header. It asks every result group at once (library, songs, albums and artists, videos, live games, history), each as its own request, so a slow or failing provider delays only its own group.
A pasted link becomes one row. An empty search is the home page: recent plays, today's games, playlists, and library posters.

Every row is drawn by one component, and its buttons are exactly the actions the server listed for it.
The server already knows what each viewer may do with each item, so the page never guesses and never offers a button that will be refused.
A song offers Listen; a film or a live game offers Watch; a video or a link offers both side by side, with no default.
When that destination is already playing, the same button queues, and the row says where the item went.

The right-hand rail is the room as the server sees it: one card per player, each with its own controls and queue.
It renders the latest snapshot from the room stream and nothing else, so two open tabs cannot disagree.
Between snapshots the playback position advances locally from the sample time the server sent, which keeps the clock moving without a request per second.

## Feedback stays beside the control

A busy flag shared by the whole page turns one slow request into a frozen remote, and a toast far from the button does not say which click failed.
Each control in the client therefore owns its pending state and reports beside itself.
A failure names its specific cause, offers Retry only when trying again can help, and shows a short reference: the first eight characters of the request's trace id.
That reference is the link between what the viewer saw and the trace an operator opens, without the viewer sending anything identifying.
Destructive controls such as Stop and Clear ask once more in place before acting.

## The browser reports shapes, not content

Everything the remote displays is personal: titles, searches, Discord names and channels.
So the browser reports only the shape of what happened.
A page view is the route pattern, such as `/album/:id`, never the path or the query.
A chosen result is its kind, a rank bucket, and which button was pressed; a shown error is its code and where it appeared.
The client's `telemetry/` module in the
[browser client](https://github.com/shepherdjerred/monorepo/tree/main/packages/streambot/src/web/client)
builds those payloads from closed vocabularies and rewrites every URL PostHog would record to its route pattern, and a unit test runs them against identifying fixture text.
Nothing loads until the server hands the page its random analytics id, and nothing loads at all under Do Not Track or Global Privacy Control.
Session replay masks every text node and every non-layout attribute, because the labels name the item; see [PostHog](/explanation/homelab/posthog/) for the shared privacy rules.

Browser errors go to the same Bugsink project as the server, tagged with the last request reference, so one reference finds both the trace and the error.

## Discovery shares media metadata

Library, queue, and player images use TMDB posters with the existing server-side credential.
Episodes use their series poster. Lookups are lazy and shared per title, so artwork
does not delay browsing or playback. YouTube search results carry their provider thumbnails.
Only supported public image CDNs can reach the browser; local paths and credentials stay on the server.
TMDB attribution appears in the remote's artwork credits.

The Live page combines StreamEast, TVSportsLive, and official LoL Esports listings.
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

## Music search returns the item that plays

Music search uses YouTube Music because its result is the playable item, not a description of one.
MusicBrainz stays as a selectable provider for the day YouTube stops answering.

MusicBrainz names recordings but says nothing about where to hear them.
A MusicBrainz result therefore needs two searches: the
[catalog](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/catalog.ts)
for an identity, then YouTube, then the
[matcher](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/matching.ts)
to guess which video was the song.
The catalog queues every request behind one 1.1 second gap shared by all viewers and makes three sequential calls per query.
It ranks by text score alone, so a popular song has no advantage over a cover, and it answers only after the viewer submits.

A YouTube Music result carries its video id.
The adapter turns that id into the track's canonical `music.youtube.com` watch URL, and
[`musicSource`](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/service.ts)
makes it a URL source that yt-dlp resolves like any other link.
There is no search-and-match step to get wrong, and typeahead needs only a second call to the same provider.
The persisted identity is the existing
[music track contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/contracts.ts),
so queues, history and saved playlists written by either provider read back unchanged.

The cost is an unofficial API.
`youtubei.js` speaks YouTube's private InnerTube protocol, which can change without notice and reports unknown nodes by logging a warning rather than failing.
Silent degradation was the risk to design against, so four layers contain it:

- **One adapter.** Only `youtube-music.ts` in the
  [music directory](https://github.com/shepherdjerred/monorepo/tree/main/packages/streambot/src/music)
  imports the library. It never builds a stream URL, so playback depends on yt-dlp alone.
- **Strict validation.** Each item is re-parsed against a strict schema in `search-provider.ts` and `youtube-music-items.ts` beside it.
  An item that fails is dropped and counted. A response where nothing validates is a typed error, never an empty list that looks like no results.
- **A flag.** An operator switches the provider per request through the feature flag read in
  [media feature gates](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/config/media-features.ts).
  An unknown value throws instead of choosing a provider.
- **Metrics.** The
  [web metrics](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/observability/web-metrics.ts)
  count provider calls by outcome, dropped items and unreadable parser nodes. None of them label a query, a title or an id.

A provider failure affects one result group.
Library, video, live and history groups are separate requests, so they keep answering.

The [web recording picker](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/web/server/music.ts)
lets a playlist's owner correct a MusicBrainz or Spotify song's video.
Saved sources retain catalog identity alongside the selected video, so [voice recovery](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/session/voice-recovery.ts)
can resolve a fresh audio URL. The [artwork resolver](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/artwork.ts)
keeps album artwork with saved playlists, queues, recovery, and player cards.
MusicBrainz covers come from the Cover Art Archive, YouTube Music covers from a short list of YouTube image hosts, and [Spotify links](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/music/spotify.ts)
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
