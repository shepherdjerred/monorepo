---
id: 2026-08-08-streambot-player-card
type: plan
status: in-progress
board: false
---

# Streambot player card — Discord-native message controls

## Context

Streambot's entire control surface was `/stream <subcommand>`. While a movie
played you had to type a slash command to skip, seek, change volume, or check
the queue, and the only public artifact in the channel was a one-shot
`▶️ Now playing **X**` line that never updated.

The player card replaces that line with a single live message per session
carrying a progress bar and control rows. It is the only UI: no web dashboard,
and no Discord Activity — Activities were ruled out because the app would not
clear Discord verification.

Everything the card drives already existed on `SessionHandle`
(`packages/streambot/src/session/session-types.ts`): `dispatch` for
`SKIP`/`STOP`/`SET_LOOP`/`SHUFFLE`, the live `seek()`/`setVolume()`
side-channels, and the subtitle picker. The gap was presentation and routing.

**Explicit non-goal: pause/resume.** The vendored `discord-video-stream` fork's
`Player` has no pause, and `src/streamer/elapsed.ts` documents the invariant it
would break — _"wall-clock elapsed ≈ media position (there is no pause feature
to account for)"_. Real pause means killing ffmpeg, restarting at position via
the seek machinery, and a paused state in both the machine and the elapsed
tracker. Every shipped control maps to an existing capability.

## Decisions

| Question       | Decision                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permissions    | Anyone in the VC: seek, volume, loop, shuffle, queue. Requester-or-admin: skip, subtitles. Admin-only: stop.                                                    |
| Card lifecycle | Fresh card per track (the previous card keeps its text, loses its controls). Re-posted when chat buries it.                                                     |
| Live position  | Ticking progress bar on a configurable interval; `0` disables.                                                                                                  |
| Card style     | Classic `EmbedBuilder` + button rows. **Not** Components V2, which forbids `embeds` and would force a rewrite of the TMDB poster path for no user-visible gain. |

Seek and volume are deliberately looser on the card than on the slash side
(`/stream seek` remains requester-or-admin): pressing a button while sitting in
the channel is a more visible act than typing a command from anywhere in the
server. The slash gates were not changed.

## Implementation

New files under `src/discord/`:

- `player-card.ts` — pure render. Progress-bar math, the embed body, button and
  chapter-menu descriptors. With the card disabled it emits the legacy plain
  `▶️ Now playing …` announcement, so both modes share one code path.
- `player-controls.ts` — pure. The `sb:v1:<action>` component-id namespace and
  the permission matrix, reusing `isAdmin`/`canControlItem` from
  `permissions.ts`. Returns a discriminated `ControlOutcome`; a denial is an
  outcome, so a click never silently fails.
- `player-card-manager.ts` — lifecycle. Track-change detection, the async-poster
  out-of-order guard, edit de-duplication, re-post counting, and `finalize()`.
  All Discord effects go through an injected `PlayerCardPort`, so it is testable
  with fakes.
- `player-card-message.ts` — the discord.js edge: descriptors → embed and action
  rows, plus the message-id → session routing table.
- `player-card-router.ts` — resolves a click to its session, applies the
  outcome, acks the presser.
- `interaction-adapters.ts`, `command-registration.ts` — extracted from
  `command-bot.ts` to keep it under the 500-line `max-lines` cap.

Routing uses a message-id table rather than ids encoded in the `customId`,
because a card outlives every interaction token: a click arriving hours later
carries only `interaction.message.id`. A card whose session has ended, or one
that predates a restart, is absent from the table and answers "That stream has
ended." `SessionManager.moveSession` re-registers the live card when a moderator
drags the streamer to another voice channel.

Notable modifications:

- `machine/view.ts` + `discord/queue-text.ts` — `QueueItemView` gains `kind`,
  `sourceId`, and `durationSeconds`: the progress bar needs the duration, poster
  lookups are gated to local files by kind, and the card's lifecycle keys on the
  source identity rather than the display title.
- `discord/status-reporter.ts` — the now-playing branch and its poster fetch
  moved to the card. The reporter keeps only one-shot notices (preparing,
  crash/retry, stop reason, adult-source shaming). `Announcement` collapsed to
  `string`, since nothing else ever produced its embed variant.
- `discord/command-bot.ts` — adds the non-privileged `GuildMessages` intent
  (message _content_ is not requested; only the fact that a message arrived
  drives the re-post), a component-interaction branch, and the `PlayerCardPort`
  handed to `SessionManager`.
- `config/schema.ts` — `playerCard: { enabled, tickMs, repostAfterMessages }`
  from `PLAYER_CARD_ENABLED` / `PLAYER_CARD_TICK_MS` /
  `PLAYER_CARD_REPOST_AFTER_MESSAGES`. Defaults are on, 10s, and 5 messages, so
  the homelab deployment needs no new environment wiring.

## Verification

`bunx turbo run typecheck test lint --filter=@shepherdjerred/streambot` is
clean, and Knip reports no unused exports.

New suites: `test/player-controls.test.ts` (id round-trip, the full permission
matrix across admin/requester/bystander/not-in-VC, loop cycling, volume and seek
clamping), `test/player-card.test.ts` (bar math, unknown duration, disabled
states, chapter truncation, finished and config-disabled renders), and
`test/player-card-manager.test.ts` (track change, late and stale posters, edit
de-duplication, re-post counting, `reown`, `finalize`).
`test/status-reporter.test.ts` lost its now-playing assertions and gained one
asserting the reporter no longer announces playback at all.

Live verification runs against the dedicated test guild described in
`packages/streambot/AGENTS.md`, never the production `streambot-config` guild.

## Review findings folded in

The first CI review pass surfaced six real defects in the initial implementation,
all fixed with regression tests:

- **Card re-post feedback loop (P1).** Sessions sharing a status channel each saw
  the others' card posts and counted them as burying traffic, so N cards could
  drive a self-sustaining delete/re-post cycle. `command-bot.ts` now excludes any
  message that is itself a registered card.
- **Old card rewritten with the next track's title (P2).** The machine exposes the
  next item as `current` while resolving, which made the card render the new title
  into the old card and then post a second card for it. The lifecycle now keys on
  `sourceId` and leaves the card alone until the new item actually streams. This
  also gives two same-titled files their own cards.
- **Transient edit failures cached as delivered (P2).** `edit` returned a boolean,
  so a rate limit or 5xx looked like success and the undelivered payload was
  cached — permanently stranding a stale card. `CardEditResult` now distinguishes
  `ok` / `gone` / `failed`, and `finalize()` falls back to `strip()` on `failed`.
- **Disabled-mode routing leak.** Legacy announcements were registered for click
  routing and never unregistered. They now post unowned.
- **Disabled-mode posters dropped.** Moving now-playing off `StatusReporter` meant
  posters could never reach the legacy announcement, which is never edited. That
  path now awaits the lookup before posting, matching the old behavior.

A second review pass then found three races in the serialized effect chain, all
stemming from reading or mutating `messageId` outside the tail:

- **A failed post was never retried**, leaving that track permanently card-less
  because `trackKey` stayed set and every later refresh took the edit path. A
  failed post now clears `trackKey` so the next refresh re-enters `beginTrack`.
- **Rapid track changes could orphan a card.** `beginTrack` captured the outgoing
  message id synchronously, which reads `null` while the previous post is in
  flight, so the old card was never stripped. The capture moved into the queued
  task, which also bails when a newer track has superseded it, and a new
  `cardTrackKey` gates edits on the live card actually representing the current
  item.
- **`finalize()` skipped in-flight posts**, so a card could be published — with
  working controls and a routing entry — for an already-torn-down session. It now
  enqueues its retire step behind the tail, and `postCard` refuses to publish once
  finished.
