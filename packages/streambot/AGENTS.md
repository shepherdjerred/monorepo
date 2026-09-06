# Streambot constraints

Streambot is a Bun service that controls Discord video playback. One command
bot serves many guilds while a bounded userbot pool streams at most one voice
channel per account. `README.md` and the streambot wiki pages own the full
architecture, media, voice, and diagnostics reference.

## Playback

- One XState actor owns each `(guild, voice channel)` session. The machine is
  pure; invoked actors own I/O. Release the userbot when the session ends.
- Identity and channel authority come from the Discord interaction/session,
  never client or model arguments.
- Preserve the player-card message contract and session persistence across
  restart. Voice loss, ffmpeg exit, skip, seek, and teardown must reach one
  deterministic terminal transition.
- Use the in-repo `discord-video-stream` fork. Profile real ffmpeg/VAAPI output
  before changing timing, queues, copying, subtitles, HDR, or buffers.

## Voice assistant

Voice wake detection is local and layered before cloud transcription. The
two-second phrase-verifier window is end-aligned from token timestamps; do not
replace it with a fixed post-detection delay. Missing required models, keys, or
recognition smoke fails startup when voice is enabled. Assets are pinned in the
image and never downloaded at runtime.

After a verified wake, the native OpenAI Realtime path may perform at most one
typed playback mutation. Actor identity comes from the detected speaker.
Assistant ducking multiplies the latest desired volume and restores on every
success, failure, timeout, interruption, and teardown path.

Wake captures are private, bounded, non-blocking diagnostics. Audio uploads
before the versioned manifest commit marker. Raw audio, credentials, Discord
IDs, transcripts, and tool arguments must not leak to logs, metrics, traces,
errors, or public artifacts. Finite metric labels only; remove session gauge
series on teardown.

Offline corpus evaluation uses the production decode and local-verification
path without OpenAI. The image must not contain the corpus. Human/live
measurements are diagnostic acceptance, not a substitute for deterministic
tests and image smoke.

Voice receive is load-bearing and depends on a patched libdatachannel
(`PeerConnection::registerIncomingSsrc`, applied by the Bun patch); Discord
announces speaker SSRCs lazily, so unregistered inbound RTP is dropped. The
patched binary ships as vendored prebuilds under
`packages/discord-video-stream/prebuilds-patched/`, overlaid at install; every
consumer image (`streambot`, `discord-plays-pokemon`, `discord-plays-mario-kart`)
must `COPY` that directory before `bun install` or the overlay hard-errors. The
`assertIncomingAudioSupported()` boot guard refuses an unpatched binary. The
realtime turn completes on the SDK `agent_end` event (not `audio_stopped`) and
accepts the `conversation.item.added` GA event name. The fake-transport unit
tests cannot catch real-API drift; `e2e/voice-receive-repro.ts` (transport) and
`voice:cloud-probe` (cloud turn) are the real-API oracles.

## Verification

```bash
bun run typecheck
bun run test
bun run test:integration
bun run lint
bun run docker:build
bun run smoke
```

Live Discord E2E and voice-recovery tests require the dedicated test guild and
ambient secrets. Distinguish package tests, image recognition smoke, live
Discord delivery, media quality, and production observability.
