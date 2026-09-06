# @shepherdjerred/voice-assistant

Shared wake-word voice-assistant pipeline, extracted from streambot with zero
behavior change. One package owns the mechanics of "a speaker in a Discord
voice channel says a wake phrase and gets one grounded spoken answer":

- **Codecs** (`codecs.ts`): `DiscordOpusDecoder` (48 kHz stereo Opus → 16 kHz
  mono f32), `DiscordOpusEncoder` (24 kHz PCM16 → paced Discord Opus), and
  `wakePcmToOpenAiPcm` (16 kHz f32 → 24 kHz PCM16), all on node-av.
- **Local cascade** (`local-models.ts`, `phrase-verifier.ts`): sherpa-onnx
  keyword spotting (native with WASM fallback under `"auto"`), an
  openWakeWord-compatible phrase verifier on onnxruntime, and Silero VAD — all
  loaded from a SHA-pinned `VoiceAssetManifest` and smoke-tested at startup.
  Verification is fatal on any mismatch; an explicit runtime never falls back.
- **Audio lifecycle** (`audio-lifecycle.ts`): the per-session state machine —
  per-speaker pre-roll, candidate provisioning, fragment-tail verification
  windows, DTX silence injection, endpointing, single-flight turn delivery,
  and the erase-everything buffer hygiene.
- **Realtime turn** (`realtime-turn.ts`): one fresh audio-only OpenAI Realtime
  WebSocket per accepted wake — transcription, strict wake-prefix gate, audio
  item delete → text item insert (privacy), tool-calling response, and paced
  reply drain, with abort/timeout races and `historyStoreAudio: false`,
  `tracingDisabled: true` preserved.
- **Reply path** (`assistant-sink.ts`, `spoken-feedback.ts`): the paced
  20 ms-per-packet sender and pre-rendered local feedback clips (rejected and
  bare wakes never bill a Realtime response).
- **Guard rails**: `CloudVerificationRateLimiter`, `isQuotaExhaustedError`,
  `VoiceMutationGate`.

**Bun-only.** The moved code uses `Bun.file`, `Bun.CryptoHasher`, and
`Bun.sleep` directly; it is not a Node-compatible library.

## What this package deliberately does not contain

No Discord library, no prom-client, no logger, no product prompt, and no wake
phrase. Everything operational or phrase-specific is an injected port
(`ports.ts`), so each consumer keeps its own metric series, trace names, tools,
and trained assets:

| Port                                                           | Consumer supplies                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `AssistantAudioTransport`                                      | `setAssistantSpeaking(bool)` + `sendAssistantOpus(opus)`                     |
| `VoiceObservability`                                           | a `VoiceLogger` + the OTel `stagePrefix`                                     |
| `VoiceLifecycleMetrics`, `RealtimeTurnMetrics`, `ReplyMetrics` | counter/histogram/gauge adapters                                             |
| `VoiceAttemptHandle`                                           | per-wake observation (spans, capture); noop provided                         |
| `VoiceAssetManifest`                                           | explicit filenames for the trained phrase's assets                           |
| `RealtimeTurnOptions`                                          | apiKey, model, voice, agent name, instructions, wake prefixes, tools factory |

Every span and span attribute this package records is
`` `${stagePrefix}.<fixed suffix>` `` — streambot passes
`stagePrefix: "streambot.voice"` and wraps its existing prom-client
instruments (`packages/streambot/src/observability/voice-metrics-ports.ts`),
so its traces and metric series stayed byte-identical across the extraction.

## Public API sketch

```ts
import {
  initializeLocalVoiceModels, // (manifest, "auto" | "native" | "wasm", logger)
  VoiceAudioLifecycle, // new ({ models, fragmentTailMs, metrics, observability, onTurn, ... })
  runRealtimeCommandTurn, // (RealtimeTurnOptions, { pcm16k, activatedAtMs, assistantAudio, ... })
  PacedAssistantSender, // new (AssistantAudioTransport, { stagePrefix, metrics, attempt?, duck? })
  loadSpokenFeedbackClips, // (assetsDir, { retry, prompt })
  verifyWakeTranscript, // (transcript, wakePrefixes)
  CloudVerificationRateLimiter,
  createNoopVoiceMetrics,
} from "@shepherdjerred/voice-assistant";
```

Input contract: `VoiceAudioInput = { userId: string; opus: Uint8Array }`.
Anything shaped like it (streambot's `ReceivedVoiceAudio`, a `@discordjs/voice`
receive frame wrapper) feeds `lifecycle.accept()` directly. The lifecycle
zero-fills every buffer it consumes.

## Consumer-adapter recipe (a @discordjs/voice bot)

1. **Assets**: train/package the bot's wake phrase and build one
   `VoiceAssetManifest` for its assets directory, plus the matching
   `fragmentTailMs` table (one entry per keyword-file fragment — a fragment
   missing from the table throws at candidate time, by design).
2. **Boot** (fatal on failure):
   `const models = await initializeLocalVoiceModels(manifest, "auto", logger)`
   then `loadSpokenFeedbackClips(assetsDir, clipFiles)`.
3. **Receive bridge**: subscribe per speaking user via `VoiceReceiver`, and for
   each Opus packet call `lifecycle.accept({ userId, opus })`.
4. **Transport adapter** over the bot's `VoiceConnection`:
   ```ts
   const transport: AssistantAudioTransport = {
     setAssistantSpeaking: async (speaking) => {
       connection.setSpeaking(speaking); // or equivalent duck/unduck hooks
     },
     sendAssistantOpus: (opus) => {
       connection.playOpusPacket(opus);
     },
   };
   ```
5. **Metrics/observability adapters**: wrap the bot's own instruments into the
   three metric port groups (or start from `createNoopVoiceMetrics()`), and
   pass `{ logger, stagePrefix: "<bot>.voice" }`.
6. **Session wiring**: construct `VoiceAudioLifecycle` with a rate limiter and
   an `onTurn` that calls `runRealtimeCommandTurn(options, { pcm16k,
activatedAtMs, assistantAudio: new PacedAssistantSender(transport, …),
feedbackClips })`, where `options.tools` returns the bot's read-only or
   gated tools and `options.wakePrefixes` matches the trained phrase.

Streambot's production binding is the worked example:
`packages/streambot/src/voice/realtime-voice.ts` (turn options + paced sender),
`packages/streambot/src/voice/local-voice.ts` (manifest + lifecycle ports), and
`packages/streambot/src/voice/voice-assistant-session.ts` (session composition
root).

## Verification

`bunx turbo run build typecheck lint test --filter=@shepherdjerred/voice-assistant`.
The moved unit tests (lifecycle, rate limiter, quota errors, asset validation,
codecs) live in `test/`; streambot's suite remains the integration proof for
the production wiring.
