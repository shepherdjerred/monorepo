---
title: Streambot voice assistant
description: Local wake-word privacy with one-shot OpenAI speech transactions bound to existing Discord playback permissions.
---

Streambot listens for voice commands only while a playback session exists. The cheap, continuous
part stays local: each pooled streamer account uses permissive sherpa fragments to nominate a
speaker, then a phrase-specific LiveKit/openWakeWord-compatible ONNX model verifies **Hey
Streambot** over the rolling audio. It opens no OpenAI connection until both local layers pass.

The whole cascade lives in
[`src/voice/`](https://github.com/shepherdjerred/monorepo/tree/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice),
with the per-session state machine in
[`audio-lifecycle.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/audio-lifecycle.ts)
and the cloud turn in
[`realtime-agent.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/realtime-agent.ts).

```mermaid
flowchart LR
  accTitle: Streambot hybrid voice command lifecycle
  accDescr: Identified Discord voice passes through a permissive sherpa candidate detector, a phrase-specific local verifier, local endpointing, and a final OpenAI transcript gate. Only a verified leading wake phrase can reach one permission-checked playback tool and a spoken reply.

  D[Discord normal voice<br/>identified Opus] --> L[Local decode and<br/>per-speaker pre-roll]
  L --> K{Permissive sherpa<br/>phrase or fragment?}
  K -->|no| L
  K -->|candidate| S[Lock triggering speaker<br/>until the fragment tail elapses]
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

Endpointing cannot be purely packet-driven: Discord clients negotiate DTX and stop sending RTP at
the end of speech, so while a candidate is pending the lifecycle runs a wall-clock ticker and,
after a missing-packet gap, feeds synthetic silence through the same path real trailing silence
would take. A broken ticker degrades to the bounded max-utterance timeout, never to extra cloud
calls.

Exact variables, asset paths, and limits are in
[Streambot voice configuration](/reference/streambot-voice/).

## Trust boundaries

The design assumption is that the model is untrusted input, not an authority. Every boundary below
exists so that a compromised or merely confused model cannot exceed what the speaker could already
do with a slash command.

- Discord's SSRC mapping supplies the user identity; the model can never choose a user ID. Tools
  bind the detected speaker in
  [`voice-tools.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/voice-tools.ts).
- `auto` searches the local library first, `local` cannot fall through, and `youtube` bypasses
  local matches. Voice tools reject URLs and expose no web search or general-purpose capability;
  the source rules live in
  [`playback-command-service.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/commands/playback-command-service.ts).
- Anyone may request media. Skip and seek retain requester-or-admin checks; stop remains admin-only.
  Voice reuses the same
  [permission predicates](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/discord/permissions.ts)
  as the slash commands rather than defining its own.
- One wake permits at most one mutating tool, enforced by `VoiceMutationGate`. Ambiguity produces a
  short retry request and no change.
- The utterance ends locally and both it and the whole cloud transaction are capped. Cloud
  verification is rate-limited per playback session by
  [`cloud-verification-rate-limiter.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/cloud-verification-rate-limiter.ts),
  with a cooldown after a rejected transcript. All PCM and verifier features are erased after
  accepted, rejected, interrupted, and timed-out trials.

## Audio paths and privacy

The normal Discord voice connection is opt-in bidirectional for Streambot: incoming DAVE audio is
decrypted before the session receives it, and assistant Opus goes back through that same connection.
The movie continues on the independent Go Live connection. During a reply Streambot applies a
ducking multiplier, then restores the newest desired playback volume—even when volume changed while
it was speaking or the Realtime call failed. That restore-on-every-path behavior is the whole
reason ducking is a multiplier over the desired volume rather than a saved-and-replayed value; see
[`assistant-audio-output.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/streamer/assistant-audio-output.ts).

Model assets are pinned into the image and checksum-verified at build time by
[the Dockerfile's `voice-models` stage](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/Dockerfile).
Voice-enabled startup fails if the dedicated OpenAI key, KWS model, phrase-verifier
manifest/checksums, ONNX runtime, or Silero VAD model is invalid —
[`local-models.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/local-models.ts)
treats every one of those as fatal rather than degrading to a weaker gate.

Each locally verified candidate is transcribed ephemerally with no prompt naming Streambot. A
local false accept therefore transmits the ~2 s pre-roll plus the utterance to the transcription
endpoint before the transcript gate rejects it and the turn closes. Queue and now-playing tool
results sent to OpenAI are requester-anonymous: no Discord user IDs leave the process. A
rejected prefix closes silently before `response.create`; an accepted prefix replaces the committed
audio item with command-only text. SDK audio history and tracing are disabled. Metrics contain only
bounded stage outcomes, usage, concurrency, and latency—never speakers, transcripts, or media
queries. The OpenAI project should use zero-data retention when that control is available.

## Confidence before enablement

Production is deliberately configured with `VOICE_ASSISTANT_ENABLED=false`. Enabling it is a global
cutover—there is no guild allowlist—so four independent gates must pass first:

1. A checked-in 400-clip generated corpus passes the exact Discord Opus → production decoder →
   sherpa KWS → phrase ONNX verifier → Silero VAD path in both native and WASM runtimes. Sherpa must
   nominate every ordinary positive; the local verifier must accept every ordinary positive,
   reject every canonical negative, and retain at least 95% recall at 10 dB SNR. The thresholds are
   executable, not prose:
   [`corpus-evaluator.ts`](https://github.com/shepherdjerred/monorepo/blob/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/src/voice/corpus-evaluator.ts).
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
[`packages/streambot/voice-training/`](https://github.com/shepherdjerred/monorepo/tree/6b8aa36e58656850415e2a040160ad96937e4a67/packages/streambot/voice-training).
Packaging requires the minimum training counts, the complete ACAV100M general-speech artifact, and
a generated positive smoke WAV. Both local runtimes must accept that checksum-pinned smoke sample;
successfully loading an ONNX graph is insufficient.

The production image requires both sherpa runtimes and the in-process phrase-verifier graph to
complete inference as the deployment user; merely opening model files is not a successful smoke.
Corpus evaluation is deliberately not a build step: it is a multi-hour acceptance measurement an
operator runs inside the built image, with the report committed to
`packages/streambot/voice-training/reports/`. None of the 400 corpus clips ship at runtime. The
emergency rollback is the same global kill switch set back to `false`.

## Related

- [Run the Streambot voice probe](/how-to/run-the-streambot-voice-probe/) — exercise the cascade from a macOS console
- [Streambot voice configuration](/reference/streambot-voice/) — variables, model assets, and fixed limits
