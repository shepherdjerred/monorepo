---
title: Run the Streambot voice probe
description: Ask "what would Streambot do if I said this?" from a macOS console, with no Discord session and no playback.
sidebar:
  order: 12
---

The probe answers one question: what would Streambot do if I said this? It
replaces only the outer adapters. AVFoundation supplies the microphone instead
of Discord, and a print-only command port replaces playback. Everything between
— the Discord Opus codec, both local wake layers, Silero endpointing, the
transcript gate, the Realtime prompt, the schemas, and the mutation gate — is
the production path.

macOS only. Run every command from `packages/streambot`.

## 1. Stage the pinned model assets

```bash
cd packages/streambot
bun run voice:harness:prepare
```

This exports the same checksum-pinned assets the image builds, so the probe
cannot silently run against different models than production.

## 2. Pick a microphone

```bash
bun run voice:harness --list-devices
```

## 3. Speak at it

```bash
OPENAI_API_KEY=... bun run voice:harness --device <index>
```

Enter starts or stops one recording. The probe prints each stage separately:
sherpa candidate, local verification, whether OpenAI was contacted, transcript
verification, the diagnostic transcript, and the typed playback arguments.

Reading the stages separately is the point. A permissive sherpa candidate that
the phrase verifier then rejects is the cascade working, not a failure.

:::caution
These are tuning trials. They are explicitly **not** the private human holdout
that gates enablement — see
[Streambot voice assistant](/explanation/streambot-voice/).
:::

## Capture audio for debugging

Nothing is written to disk by default. To capture, add `--save-recordings`:

```bash
OPENAI_API_KEY=... bun run voice:harness --device <index> --save-recordings
```

| Flag                      | Effect                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `--save-recordings`       | Writes the pre-Opus microphone input and the exact post-Opus audio committed to OpenAI |
| `--recordings-dir <path>` | Chooses another location and implies `--save-recordings`                               |

Saved files are lossless 24 kHz mono WAVs under
`.context/streambot-voice-recordings`, with peak and RMS levels printed for
each. Transcripts and tool queries are never saved by the local probe.
Production wake captures use a different private, 90-day diagnostic contract;
see [Diagnose Streambot voice](/how-to/diagnose-streambot-voice/).

## Replay saved samples offline

Replay never constructs Realtime and never contacts OpenAI.

```bash
bun run voice:harness:evaluate \
  --positive-dir ../../.context/streambot-voice-recordings \
  --positive-pattern '^trial-' \
  --negative-dir ../../.context/streambot-kws-negatives \
  --runtime native
```

FFmpeg normalizes each file; everything after that is the production Discord
Opus encoder and decoder plus the full local cascade. Output separates sherpa
candidates from local-verifier passes.

Add `--runtime both --require-perfect` for the blocking native/WASM comparison —
use it when a change could plausibly make the two runtimes disagree.

## Related

- [Streambot voice assistant](/explanation/streambot-voice/) — why the cascade is shaped this way
- [Streambot voice reference](/reference/streambot-voice/) — variables, assets, diagnostics, and fixed limits
- [Diagnose Streambot voice](/how-to/diagnose-streambot-voice/) — production metrics, traces, logs, and private captures
