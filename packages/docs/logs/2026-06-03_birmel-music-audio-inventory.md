# Birmel Music / Audio Inventory

## Status

Complete

## Summary

Reviewed Birmel's music and audio-related code paths in `packages/birmel` plus the homelab/Dagger deployment support that affects voice playback.

## Findings

- Birmel has a dedicated VoltAgent `music-agent` for music playback, queue management, and voice channel work.
- The supervisor prompt routes music, queue, and voice requests to `music-agent`.
- The music agent exposes two tool families:
  - `music-playback`: play, pause, resume, skip, stop, seek, set volume, set loop, now playing.
  - `music-queue`: get queue, add track, remove track, shuffle, clear.
- Playback uses `discord-player` and `discord-player-youtubei` for search/extractor integration.
- YouTube streaming is backed by `youtube-dl-exec`/yt-dlp through a custom stream function in `src/music/extractors.ts`.
- The extractor passes `jsRuntimes: "node"`, so production playback depends on a real `node` binary being present in the image.
- Birmel initializes the music player unconditionally after Discord login in `src/index.ts`; `VOICE_ENABLED=true` exists in `.env.example` and homelab env, but this checkout does not appear to read it as a runtime gate.
- Discord voice state intent is configured through `GatewayIntentBits.GuildVoiceStates`.
- Track starts are recorded to the Prisma `MusicHistory` model through a fire-and-forget repository call.
- There are two live-style E2E scripts:
  - `bun run test:e2e:music` for Discord guild voice playback.
  - `bun run test:e2e:youtube-stream` for resolving a YouTube track into a Discord audio packet.
- The homelab Birmel NetworkPolicy allows external TCP/443 plus UDP `50000-65535` for Discord voice media, with a synthesis test covering the UDP rule.

## Caveats

- I did not run live Discord/YouTube playback because it needs real Discord credentials, configured test guild/channel IDs, and network access.
- The current Dagger Birmel smoke test checks `gh` and `claude`, but does not explicitly assert `node` is available even though yt-dlp is configured with `jsRuntimes: "node"`.
- `.env.example` still labels `VOICE_ENABLED` under "Voice/TTS" alongside `TTS_VOICE`/`TTS_SPEED`, but no TTS implementation or config schema entries for those variables showed up in this pass.

## Session Log - 2026-06-03

### Done

- Loaded relevant Discord and TypeScript skills.
- Searched memory and `toolkit recall` for prior Birmel music/audio context.
- Inspected Birmel music source, music tools, agent routing, config, Discord intents, database history, E2E scripts, homelab NetworkPolicy, and Dagger smoke coverage.
- Added this log at `packages/docs/logs/2026-06-03_birmel-music-audio-inventory.md`.

### Remaining

- Live playback was not verified. To prove end-to-end behavior, run `bun run --filter='./packages/birmel' test:e2e:music` with real Discord E2E env vars.
- YouTube packet generation was not verified. To test the extractor without joining Discord voice, run `bun run --filter='./packages/birmel' test:e2e:youtube-stream` with `BIRMEL_E2E_YOUTUBE_QUERY` and working network access.
- Consider adding Dagger smoke coverage for `command -v node` because the extractor requires Node for yt-dlp JS runtime handling.

### Caveats

- This was a static repo inventory, not a live production/pod check.
- The prior memory said Node smoke coverage had been added, but this checkout does not show that assertion in `.dagger/src/misc.ts` or `scripts/ci/src/__tests__/dagger-hygiene.test.ts`.
