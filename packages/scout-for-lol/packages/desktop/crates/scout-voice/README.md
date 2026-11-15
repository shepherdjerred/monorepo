# scout-voice

Scout Desktop's local voice cascade. It takes microphone audio, resamples it
to 16 kHz mono, listens for "hey scout", checks the phrase, waits for the end
of speech, and returns the utterance as an in-memory WAV. Push-to-talk is the
second trigger.

The crate opens no socket. The microphone never streams anywhere: the only
output is an `Utterance`, and sending it to the server is the caller's
decision. Nothing here is wired into the app yet.

## Pieces

| Module             | Role                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `audio`, `capture` | `AudioInput`: `FileInput` (WAV, cycling chunk sizes) and `CpalInput` (default device)  |
| `resample`         | `MonoResampler`: downmix plus rubato's FFT resampler to 16 kHz                         |
| `detect`           | `KeywordSpotter`, `VoiceActivity` and `WakeVerifier` traits                            |
| `sherpa`           | sherpa-onnx keyword spotting and Silero VAD                                            |
| `verifier`         | the trained "hey scout" phrase verifier (mel, embedding, classifier) on tract          |
| `state`            | `VoiceMachine`: Idle, Armed, Capturing, Ended, as a pure transition function           |
| `conversation`     | `conversation_open(phase)`: the microphone is open only while gameflow is `InProgress` |
| `pipeline`         | `VoicePipeline`: pre-roll, candidate, verification, end of speech, limits              |
| `contract`         | serde reader for `data/src/scout-client/voice-cascade.contract.json`                   |
| `models`           | locating the model directory and checking every SHA-256                                |

The pipeline is a port of the capture half of
`packages/voice-assistant/src/audio/audio-lifecycle.ts`, which the Discord
voice preview runs. Its settings come from the shared contract, which the Zod
schema `voice-cascade.schema.ts` validates too. The Discord preview still
reads its own constants: the VAD and spotter settings live in the shared
`@shepherdjerred/voice-assistant` package, which streambot also uses, so
moving them onto the contract is its own change.

An utterance is held in `Ended` until the caller calls `finish_turn`, so
audio arriving while Scout speaks its answer cannot wake it.

## Platforms

`cpal` and `sherpa-onnx` are dependencies only on Windows and macOS, as GPUI
is in `scout-desktop-ui`. cpal needs ALSA headers on Linux, and sherpa-onnx's
own CI excludes static linking on x86_64 Linux. Linux CI builds and tests
the contract, resampler, verifier, state machine and pipeline; `cargo tree`
for a Linux target lists neither crate.

## Native library supply chain

`sherpa-onnx-sys` downloads its static library from GitHub releases in its
`build.rs`, with no checksum. Its supported override is
`SHERPA_ONNX_ARCHIVE_DIR`: a directory holding the archive it would have
downloaded, which it copies instead of fetching. `bun run voice:sherpa-libs`
(`desktop/scripts/fetch-sherpa-libs.ts`) downloads the archives pinned with
SHA-256 in `desktop/sherpa-onnx-libs.json` and fails on any mismatch;
`release:package:*` runs it and sets `SHERPA_ONNX_ARCHIVE_DIR` for the build.
The pins were taken from the v2.0.1 release assets when first downloaded
(upstream publishes no checksums). Bumping `sherpa-onnx` means updating the
version, file names and hashes in that JSON together. A plain `cargo build`
or `bun run package:*` still uses the unverified download; those are
development builds.

## Model files

Models are never committed under `desktop/` and never downloaded at runtime.

```bash
bun run voice:models            # assembles target/voice-models
```

`scripts/fetch-voice-models.ts` downloads the keyword spotter archive and
Silero VAD from the pinned URLs in the contract (the same files and checksums
the backend image pins), and copies the trained verifier and keywords file
from `backend/assets/voice`, where they are already committed. At runtime
`ModelPaths::locate` checks every file again and fails on anything missing or
altered. Bundling the directory into the installer is a later change.

`sherpa-onnx-sys` downloads its prebuilt static library from the sherpa-onnx
GitHub release at build time without a checksum. `SHERPA_ONNX_ARCHIVE_DIR`
points it at a vetted copy instead; the release build should use that.

## Running

```bash
mise exec -- cargo test -p scout-voice
mise exec -- cargo bench -p scout-voice
mise exec -- cargo run --release -p scout-voice --example spike -- target/voice-models latency <wake.wav> <question.wav>
mise exec -- cargo run --release -p scout-voice --example spike -- target/voice-models idle 30 realtime
mise exec -- cargo run --release -p scout-voice --example capture -- 10 target/voice-models
```

`tests/verifier.rs` runs the real verifier on the committed backend assets.
`tests/pipeline.rs` plays a 48 kHz stereo WAV through the whole pipeline with
energy-based fakes in place of the models, so it needs no download.

## Spike results

Measured on 2026-11-14 on a Mac mini (Apple M5 Pro), release build, Rust 1.99.

**One binary, one ONNX Runtime.** sherpa-onnx 2.0.1 links ONNX Runtime 1.28.2
statically and runs both keyword spotting and Silero VAD, so those two share
one runtime by construction. The verifier is the second ONNX consumer. Adding
`ort` 2.0.0-rc.15 (ONNX Runtime 1.31) beside it linked on macOS only with 525
duplicate-symbol warnings: two runtime versions with one copy of each symbol
chosen at link time. MSVC rejects duplicate definitions outright. So the
verifier runs on tract-onnx 0.23.10, which is pure Rust: the same build has no
duplicate symbols. tract matches the production ONNX Runtime verifier on the
same arrays to within 1e-6:

| Clip                             | ONNX Runtime | tract    |
| -------------------------------- | ------------ | -------- |
| `hey-scout-smoke.wav`            | 0.944377     | 0.944377 |
| `say` Samantha "hey scout"       | 0.985030     | 0.985030 |
| `say` Daniel "hey scout"         | 0.978393     | 0.978393 |
| `say` "what should I build next" | 0.001963     | 0.001963 |
| two seconds of silence           | 0.002231     | 0.002231 |

For Windows, sherpa-onnx's `test-rust.yaml` passed on `windows-latest` and
`windows-11-arm` in both static and shared modes (run 40507016704, 2026-10-27;
the latest run, 43464679831, failed only its Termux jobs). tract and rubato
are pure Rust, and cpal uses WASAPI. This is plausible, not proven: no
Windows build was run here.

**Latency.** There is no recorded "hey scout" fixture in the repository (the
backend corpus is Discord Opus), so the wake clips were generated with macOS
`say` in eight voices and played as one second of silence, the wake phrase,
250 ms of silence, the question and two seconds of silence. Times are audio
time after the speech ends:

| Stage                                  | Median  | Range           |
| -------------------------------------- | ------- | --------------- |
| Keyword candidate                      | +232 ms | -112 to +540 ms |
| Wake verified                          | +304 ms | +148 to +540 ms |
| End of speech (Silero, 650 ms silence) | +802 ms | +731 to +816 ms |

All eight voices were spotted and verified (scores 0.45 to 0.99). For every
voice the Rust candidate fired on the same 20 ms frame as the production
`sherpa-onnx-node` spotter given the same audio. Compute adds little: the
verifier takes 13 ms per call and the spotter 0.21 ms per 20 ms frame, and the
slowest frame took 20 ms. Models check and load in 230 to 300 ms.

**Idle listening.** Armed over silence the spotter costs 0.21 ms per 20 ms
frame, 1.0% of one core. Paced in real time for 30 s, the whole process used
0.60 s of CPU including model loading (2.0% of one core; about 1.2% after
loading) with a 79 MB peak resident set.

**Capture and resampling.** The file-backed test plays 48 kHz and 44.1 kHz
stereo tones in irregular chunks (441, 512, 480, 1024, 37 and 1 frames). The
output equals one-buffer resampling to 1e-6, keeps the sample count, and has
no step larger than a clean 1 kHz tone allows; a test proves that check
catches a dropped chunk. Resampling 48 kHz stereo costs 0.07% of one core
and adds 43 output frames (2.7 ms) of delay. Live cpal capture was not
measured: this Mac mini has no audio input, and opening the default input
fails with `kAudioHardwareBadObjectError` (`!obj`).
