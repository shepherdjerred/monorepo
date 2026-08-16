---
title: Streambot voice configuration
description: Environment variables, model asset paths, and the fixed limits that bound a voice command turn.
sidebar:
  order: 7
---

Every voice setting Streambot reads, and every limit it enforces without a
setting. Why the design looks like this is in
[Streambot voice assistant](/explanation/streambot-voice/).

## Environment variables

Parsed once at boot by
[`config/index.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/config/index.ts)
and validated by
[`VoiceConfigSchema`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/config/schema.ts).
An invalid value fails startup rather than degrading.

| Variable                       | Default                | Meaning                                                          |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------- |
| `VOICE_ASSISTANT_ENABLED`      | `false`                | Global on/off. The only rollout and rollback control.            |
| `OPENAI_API_KEY`               | —                      | Required when enabled. Startup fails without it.                 |
| `VOICE_MODEL`                  | `gpt-realtime-2.1`     | Response model. Fixed value.                                     |
| `VOICE_ASSISTANT_VOICE`        | `marin`                | Reply voice. Fixed value.                                        |
| `VOICE_WAKE_PHRASE`            | `Hey Streambot`        | Wake phrase. Fixed value; the verifier model is phrase-specific. |
| `VOICE_ASSETS_DIR`             | `/opt/streambot/voice` | Directory the pinned model assets are read from.                 |
| `VOICE_KWS_RUNTIME`            | `auto`                 | `auto`, `native`, or `wasm`. `auto` prefers the native addon.    |
| `VOICE_PRE_ROLL_MS`            | `2000`                 | Rolling audio retained before a candidate. Max `3000`.           |
| `VOICE_MAX_UTTERANCE_MS`       | `15000`                | Utterance cap after the candidate. Max `15000`.                  |
| `VOICE_TRANSACTION_TIMEOUT_MS` | `30000`                | Whole cloud turn, including the paced spoken reply. Max `30000`. |

## Model assets

Fetched and checksum-verified while building the image, never at runtime, by
[the `voice-models` stage](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/Dockerfile).
All live in `VOICE_ASSETS_DIR`, and
[`validateVoiceAssets`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/local-models.ts)
fails startup if any is missing.

| Asset                     | Source                                         |
| ------------------------- | ---------------------------------------------- |
| sherpa KWS zipformer      | Pinned sherpa-onnx `kws-models` release        |
| `silero_vad.onnx`         | Pinned sherpa-onnx `asr-models` release        |
| `melspectrogram.onnx`     | Repository, `packages/streambot/assets/voice`  |
| `embedding_model.onnx`    | Repository, `packages/streambot/assets/voice`  |
| `hey_streambot.onnx`      | Repository, `packages/streambot/assets/voice`  |
| `hey-streambot-smoke.wav` | Repository, generated positive smoke sample    |
| `wake-verifier.json`      | Repository, SHA-256s plus training attestation |

## Fixed limits

Not configurable. Each is enforced in code.

| Limit                                        | Value      | Enforced by                                                                                                                                                                                      |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Speaker lock before the phrase verifier runs | 1250 ms    | [`audio-lifecycle.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/audio-lifecycle.ts)                                 |
| Audio retained after the verifier accepts    | 300 ms     | [`audio-lifecycle.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/audio-lifecycle.ts)                                 |
| Packet gap treated as DTX end-of-stream      | 120 ms     | [`constants.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/voice/constants.ts)                                                                                 |
| Synthetic silence injected per DTX tick      | 100 ms     | [`constants.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/voice/constants.ts)                                                                                 |
| Cloud verification burst per session         | 2          | [`cloud-verification-rate-limiter.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/cloud-verification-rate-limiter.ts) |
| Cloud verifications per rolling minute       | 5          | [`cloud-verification-rate-limiter.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/cloud-verification-rate-limiter.ts) |
| Cooldown after a rejected transcript         | 3000 ms    | [`cloud-verification-rate-limiter.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/cloud-verification-rate-limiter.ts) |
| Mutating playback tools per wake             | 1          | [`VoiceMutationGate`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/voice-tools.ts)                                      |
| Go Live ducking during a reply               | 20% volume | [`assistant-audio-output.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/streamer/assistant-audio-output.ts)                |

## Related

- [Streambot voice assistant](/explanation/streambot-voice/) — why the cascade is shaped this way
- [Run the Streambot voice probe](/how-to/run-the-streambot-voice-probe/) — exercise the cascade locally
