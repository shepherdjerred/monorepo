---
title: Streambot voice assistant
description: Local wake-word privacy with one-shot OpenAI speech transactions bound to existing Discord playback permissions.
---

Streambot listens for voice commands only while a playback session exists. The cheap, continuous
part stays local: each pooled streamer account uses permissive sherpa fragments to nominate a
speaker, then a phrase-specific LiveKit/openWakeWord-compatible ONNX model verifies **Hey
Streambot** over the rolling audio. It opens no OpenAI connection until both local layers pass.

```mermaid
flowchart LR
  accTitle: Streambot hybrid voice command lifecycle
  accDescr: Identified Discord voice passes through a permissive sherpa candidate detector, a phrase-specific local verifier, local endpointing, and a final OpenAI transcript gate. Only a verified leading wake phrase can reach one permission-checked playback tool and a spoken reply.

  D[Discord normal voice<br/>identified Opus] --> L[Local decode and<br/>per-speaker pre-roll]
  L --> K{Permissive sherpa<br/>phrase or fragment?}
  K -->|no| L
  K -->|candidate| S[Lock triggering speaker<br/>for 1.25 seconds]
  S --> W{Phrase-specific<br/>local ONNX verifier}
  W -->|reject| L
  W -->|pass| V[Silero VAD from candidate<br/>ends command]
  V --> O[Commit audio to<br/>gpt-transcribe]
  O --> C{Leading normalized<br/>Hey Streambot?}
  C -->|reject| L
  C -->|pass| T[Delete audio item; add verified command text;<br/>request one gpt-realtime-2.1 response]
  T --> P[One typed, permission-checked<br/>playback tool]
  P --> R[Short spoken reply<br/>over normal voice]
  R --> L
  G[Separate Go Live<br/>movie audio and video] -. duck to 20% .-> R
```

## Trust boundaries

- Discord's SSRC mapping supplies the user identity; the model can never choose a user ID.
- `auto` searches the local library first, `local` cannot fall through, and `youtube` bypasses
  local matches. Voice tools reject URLs and expose no web search or general-purpose capability.
- Anyone may request media. Skip and seek retain requester-or-admin checks; stop remains admin-only.
- One wake permits at most one mutating tool. Ambiguity produces a short retry request and no change.
- The utterance ends locally, is capped at 15 seconds, and the full transaction is capped at 30.
  Cloud verification is limited to a burst of two and five attempts per minute per playback
  session, with a three-second cooldown after rejection. All PCM and verifier features are erased
  after accepted, rejected, interrupted, and timed-out trials.

## Audio paths and privacy

The normal Discord voice connection is opt-in bidirectional for Streambot: incoming DAVE audio is
decrypted before the session receives it, and assistant Opus goes back through that same connection.
The movie continues on the independent Go Live connection. During a reply Streambot applies a 20%
ducking multiplier, then restores the newest desired playback volume—even when volume changed while
it was speaking or the Realtime call failed.

Model assets are pinned into the image and checksum-verified at build time. Voice-enabled startup
fails if the dedicated OpenAI key, KWS model, phrase-verifier manifest/checksums, ONNX runtime, or
Silero VAD model is invalid. Each locally verified candidate is transcribed ephemerally with no
prompt naming Streambot. A rejected prefix closes silently before `response.create`; an accepted
prefix replaces the committed audio item with command-only text. SDK audio history and tracing are
disabled. Metrics contain only bounded stage outcomes, usage, concurrency, and latency—never
speakers, transcripts, or media queries. The OpenAI project should use zero-data retention when
that control is available.

## Local microphone probe

The macOS console probe answers “what would Streambot do if I said this?” without Discord or a
playback session:

```bash
cd packages/streambot
bun run voice:harness:prepare
bun run voice:harness --list-devices
OPENAI_API_KEY=... bun run voice:harness --device <index>
```

Enter starts or stops one recording. The probe prints sherpa candidate, local verification, OpenAI
contact, transcript verification, diagnostic transcript, and typed playback arguments separately.
Microphone audio still traverses the production Discord Opus codec, both local wake layers, Silero
endpointing, transcript gate, Realtime prompt, schemas, and mutation gate. Only ingress and
execution differ: AVFoundation replaces Discord, and a print-only command port replaces playback.
By default nothing is saved, and these tuning trials do not count as the private human holdout.

For an explicit debugging capture, add `--save-recordings`. The probe then writes the exact
pre-Opus microphone input and the exact post-Opus/post-lifecycle audio committed to OpenAI as
lossless 24 kHz mono WAVs under `.context/streambot-voice-recordings`, with peak/RMS levels for
each. `--recordings-dir <path>` chooses another location and implies recording. Normal runs remain
non-persistent; saved debug recordings are private local artifacts and never count as acceptance
holdouts. Transcripts and tool queries are not saved.

Saved samples can be replayed without OpenAI:

```bash
bun run voice:harness:evaluate \
  --positive-dir ../../.context/streambot-voice-recordings \
  --positive-pattern '^trial-' \
  --negative-dir ../../.context/streambot-kws-negatives \
  --runtime native
```

This command normalizes each file, encodes and decodes Discord Opus, and enters the production
cascade. It reports sherpa candidates separately from local-verifier passes. Add `--runtime both
--require-perfect` for the blocking native/WASM gate.

## Confidence before enablement

Production is deliberately configured with `VOICE_ASSISTANT_ENABLED=false`. Enabling it is a global
cutover—there is no guild allowlist—so four independent gates must pass first:

1. A checked-in 400-clip generated corpus passes the exact Discord Opus → production decoder →
   sherpa KWS → phrase ONNX verifier → Silero VAD path in both native and WASM runtimes. Sherpa must
   nominate every ordinary positive; the local verifier must accept every ordinary positive,
   reject every canonical negative, and retain at least 95% recall at 10 dB SNR.
2. Three people supply a private 30-clip holdout under `.context`. All 15 wake commands must work
   through both local layers and final transcript verification, while all 15
   near-match/background clips produce no final wake, reply, or command. The recordings are deleted
   after the aggregate result is written and are never used for tuning.
3. The live two-account Discord/OpenAI matrix passes twice. It attributes reply packets to the
   acquired userbot, requires DAVE, decodes non-silent audio, checks exact privacy-safe metric
   deltas, exercises every playback tool and permission boundary, and proves two same-guild
   sessions do not cross.
   A separate invalid-credential mode must prove a real Discord wake fails closed while Go Live
   keeps advancing.
4. Ten production commands and a 60-minute background soak show no false wakes, stuck duck,
   cross-session action, repeated provider error, or sensitive metric/log content.

The latest local diagnostic set does not pass this gate. The packaged sherpa matcher recognized
8/11 intended wake recordings but falsely activated on 14/48 generated near-match and ordinary
speech clips. A separate noise-trained phrase-classifier experiment also failed to separate the
same untouched post-Opus holdout. Neither result changes production assets or the disabled rollout
state.

The full phrase-verifier recipe and operator procedure live in
`packages/streambot/voice-training/`. Packaging requires the minimum training counts, the complete
ACAV100M general-speech artifact, and a generated positive smoke WAV. Both local runtimes must
accept that checksum-pinned smoke sample; successfully loading an ONNX graph is insufficient.

The production image first requires both sherpa runtimes and the in-process phrase-verifier graph to
complete inference as the deployment user; merely opening model files is not a successful smoke. It then evaluates
the corpus as the deployment UID and keeps only an aggregate report and pass marker; none of the
400 corpus clips ship at runtime. The emergency rollback is the same global kill switch set back to
`false`.
