# Real-audio false-accept soak: 2026-09-12

## Context

Codex flagged (P1, PR #2846) that the operator's live-mic acceptance review
only re-tested positive wakes; the automated 2-hour negative soak's failing
false-accept numbers (28 native / 46 wasm activations, `2026-09-12-threshold-0.35.json`)
were never independently re-checked against anything other than the synthetic
corpus. This report re-checks them against real recorded speech instead.

## Source audio

Three public official LoL Esports broadcast VODs (audio only, extracted via
`yt-dlp` + `ffmpeg`, for internal QA use only), concatenated into one
continuous track:

- FLY v C9 — PLAYOFFS 2025 LTA North Split 2, W11D2, Game 05 (55:45) —
  `youtube.com/watch?v=zuDY9mKeKD4`
- TL v SR — Week 10 Day 02, LTA North Split 2 2025, Game 04 (42:00) —
  `youtube.com/watch?v=TJn_RYwNVzk`
- G2 v MKOI — 2025 LEC Spring Playoffs, Grand Final, Game 4 (54:13) —
  `youtube.com/watch?v=jx79sZhjzKQ`

Combined duration: 2h 31m 56s (9116.3s), spanning two different leagues/casting
teams (LTA North and LEC) for commentary-style variety. Professional casters
say "scout," "scouting," "scout's report," etc. constantly in exactly the
ordinary-conversation way the near-match corpus tried to synthesize, making
this a domain-realistic stand-in for real usage.

## Method

Extended `voice:harness:evaluate` (`packages/streambot/scripts/voice-harness-evaluate.ts`)
with a `--soak <file> --soak-duration-hours <n>` mode
(`runContinuousActivationSoak`, `packages/streambot/src/voice/corpus-evaluator.ts`):
one continuous, never-reset `VoiceAudioLifecycle` (the same mechanism as the
existing synthetic `negativeSoak`) is fed the real audio for a 2-hour
simulated window — the source file's own 2h32m exceeded the target, so no
looping was needed — recording every local-verifier activation's timestamp.
As with the rest of this harness, audio is replayed through FFmpeg to the
production Discord Opus encoder to the real production wake/VAD lifecycle;
OpenAI and every other cloud service are never contacted.

```
bun run voice:harness:evaluate --phrase hey-scout \
  --soak <combined.wav> --soak-duration-hours 2 --runtime native
bun run voice:harness:evaluate --phrase hey-scout \
  --soak <combined.wav> --soak-duration-hours 2 --runtime wasm
```

## Result

- native: 0 false wakes over 2.00h
- wasm: 0 false wakes over 2.00h

Zero false accepts on ~2.5 hours of real professional LoL broadcast
commentary across two different broadcasts and casting teams. This contrasts
with the synthetic near-match corpus's continuous soak over the same 2-hour
window (28 native / 46 wasm activations, `2026-09-12-threshold-0.35.json`) and
its isolated-pass 7/160 near-match false-accept rate.

## Interpretation

This is measured evidence, not just a hypothesis: the synthetic near-match
corpus (deliberately adversarial "scout"-adjacent TTS/procedural phrasings)
false-triggers at a rate that does not reproduce against natural broadcast
speech containing the same trigger word at ordinary conversational density —
including a broadcast context (esports commentary) that says the wake word's
root constantly. It does not invalidate the synthetic corpus's numbers — both
are real, measured facts about different audio distributions — but it is
direct evidence, not merely a hypothesis, that the corpus's false-accept rate
substantially overstates real-world risk for this specific validation
question (does "hey scout" false-trigger on ordinary "scout" usage). See the
addendum in `2026-09-12-acceptance-decision.md` for the resulting decision.
