# Userbots stay in voice forever when only peer userbots remain

## Status

Partially Complete — Code shipped in PR #1246; deployment wiring of `peer_userbot_ids` via Helm/1P still pending.

## Session Log — 2026-06-14

### Done

- Added pure `viewer-presence` helper (`packages/discord-stream-lifecycle/src/viewer-presence.ts`) + unit tests (`test/viewer-presence.test.ts`, 12 cases).
- Wired all three userbots to consume `countRealViewers`:
  - `packages/discord-plays-pokemon/packages/backend/src/discord/channel-handler.ts` + `config/schema.ts` (`peer_userbot_ids`).
  - `packages/discord-plays-mario-kart/packages/backend/src/discord/channel-handler.ts` + `config/schema.ts` (`peer_userbot_ids`).
  - `packages/streambot/src/discord/command-bot.ts` (`evaluateChannelOccupancy`) + `config/schema.ts` (`discord.peerUserbotIds`).
- All four packages green on `tsc --noEmit`, lint, and tests.
- PR #1246 opened.

### Remaining

- Populate `peer_userbot_ids` in each bot's deployment values (1P/Helm) with the IDs of the other two userbots. The Go Live fingerprint covers the bug in the meantime, but the explicit list is the more reliable signal once configured.
- Live end-to-end verification in the homelab (human leaves shared VC → all three bots disconnect within their respective grace windows).

### Caveats

- Streambot has 4 pre-existing failing tests in `integration/subtitles.integration.test.ts` / `test/video-graph.test.ts`. These are local-ffmpeg environment failures ("No such filter: 'subtitles'" — missing libass) and unrelated to this PR.
- Streambot's config field is camelCase (`peerUserbotIds`) to match the rest of `discord.*`; the two game bots use snake_case (`peer_userbot_ids`) to match their TOML schema convention.

## Context

Glitter Kart, Pokébot, and Streambot are Discord _userbots_ (real user accounts via `discord.js-selfbot-v13`). When they share a voice channel and the last human leaves, each one looks at the channel, sees the _other_ userbots as real users, and stays — they keep each other alive forever.

Why `member.user.bot` doesn't help: peer userbots are real Discord user accounts, so `user.bot === false` for them. The only stable signals are (a) known peer user IDs and (b) voice-state heuristics like _streaming + selfDeaf + selfMute_ (a human who Go Lives almost always wants to hear/talk; that combo is a tight fingerprint of a Go Live userbot).

Three independent implementations are wrong in similar ways:

| Bot          | Filter site                                                                         | Current "real viewer" filter                   | Bug                                                              |
| ------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Pokébot      | `packages/discord-plays-pokemon/packages/backend/src/discord/channel-handler.ts`    | `member.id !== userbot.id`                     | Counts real bots and peer userbots                               |
| Glitter Kart | `packages/discord-plays-mario-kart/packages/backend/src/discord/channel-handler.ts` | `member.id !== userbot.id`                     | Same                                                             |
| Streambot    | `packages/streambot/src/discord/command-bot.ts` (`evaluateChannelOccupancy`)        | `!member.user.bot && member.id !== streamerId` | Excludes real bots — but peer userbots have `user.bot === false` |

## Fix — one shared helper in `discord-stream-lifecycle`

Add a pure helper to `packages/discord-stream-lifecycle/src/viewer-presence.ts`:

```ts
type ViewerCandidate = {
  id: string;
  isBot: boolean;        // user.bot — true for real bot applications
  streaming: boolean;    // VoiceState.streaming — Go Live active
  selfDeaf: boolean;
  selfMute: boolean;
};

type ViewerPresenceOptions = {
  selfUserId: string;
  peerUserbotIds?: readonly string[];
  excludeBots?: boolean;            // default true
  excludeLikelyUserbots?: boolean;  // default true — selfDeaf && selfMute && streaming
};

isRealViewer(c, opts): boolean
countRealViewers(members, opts): number
```

Layered exclusion: known peer IDs (reliable for known peers) + Go Live fingerprint (catches future / forgotten ones). All three bots already depend on `discord-stream-lifecycle`.

### Call-site changes

| Package                    | Filter site                                               | Schema                                                                                         |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `discord-plays-pokemon`    | `packages/backend/src/discord/channel-handler.ts`         | `peer_userbot_ids: z.array(z.string()).default([])` in `packages/backend/src/config/schema.ts` |
| `discord-plays-mario-kart` | same path                                                 | same                                                                                           |
| `streambot`                | `src/discord/command-bot.ts` (`evaluateChannelOccupancy`) | same in `src/config/schema.ts`                                                                 |

Each bot maps `channel.members` → `ViewerCandidate[]` (pulling streaming/deaf/mute from `channel.guild.voiceStates.cache.get(memberId)`) and calls `countRealViewers`.

### Out of scope

- New shared package.
- Migrating Streambot fully onto the shared xstate machines.
- Cleaning up the unused `require_watching` / `minimum_in_channel` fields.

## Deployment

Each bot's deployment needs `peer_userbot_ids` populated with the other two userbots' IDs (Helm/1P wiring — TBD). Default `[]` keeps current behavior; the Go Live heuristic does the work until IDs are wired.

## Verification

1. `typecheck` / `test` / `eslint . --fix` in lifecycle + three bot backends.
2. Unit tests in `discord-stream-lifecycle` covering each filter case.
3. Live e2e: all three bots in one VC, human leaves → all three leave (immediately for pokemon/mariokart, 30s for streambot). Human rejoins → re-stream.
4. Regression: streambot idle-timeout (playback empty) still works.

## Critical files

- `packages/discord-stream-lifecycle/src/viewer-presence.ts` (new)
- `packages/discord-stream-lifecycle/src/index.ts` (re-export)
- `packages/discord-stream-lifecycle/test/viewer-presence.test.ts` (new)
- `packages/discord-plays-pokemon/packages/backend/src/discord/channel-handler.ts`
- `packages/discord-plays-pokemon/packages/backend/src/config/schema.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/discord/channel-handler.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/config/schema.ts`
- `packages/streambot/src/discord/command-bot.ts` (`evaluateChannelOccupancy`)
- `packages/streambot/src/config/schema.ts`
- Helm/1P wiring for each deployment (TBD)
