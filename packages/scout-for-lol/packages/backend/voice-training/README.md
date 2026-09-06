# Scout "hey scout" phrase-verifier training

The Scout wake verifier is trained with LiveKit's openWakeWord-compatible
`livekit-wakeword` pipeline at commit `95448a7559c453fcd87645bd67b247ffb45f85b0` — the same
pinned checkout, base model, and procedure as streambot's
(`packages/streambot/voice-training/README.md`). The checked-in `scout-cascade.yaml` is the
canonical recipe. All corpus/training/packaging tooling lives in `packages/streambot` and is
phrase-parameterized; Scout work selects it with `--phrase hey-scout` / `--phrase-slug hey-scout`.

## Already committed (no GPU needed)

- `../assets/voice/hey-scout.txt` — sherpa KWS keywords. Generated from the pinned base model's
  own `bpe.model`/`tokens.txt` (byte-for-byte reproducible via
  `bun run voice:keywords:generate --phrase-slug hey-scout`; `--check` verifies it) and
  validated by loading both sherpa runtimes with it. `@SCOUT` starts at a raised per-line
  threshold (`#0.15`) because "scout" is common speech; tune that line further upward if the
  evaluation candidate rate is high — never the global `keywordsThreshold`.
- `../assets/voice/fragment-tails.json` — fragment tail table (`HEY_SCOUT: 0`, `SCOUT: 0`,
  `HEY: 500`). The 500 ms `HEY` tail is provisional pending measurement against trained assets
  using the method documented at `packages/streambot/src/voice/constants.ts`.

## Machine split

- **Linux GPU worker** (single 24 GB-class GPU, 50–100 GB free disk): dataset setup and the
  100,000-step training run. Expect roughly **1–2 days wall-clock** end to end; no paid
  credentials are involved.
- **macOS operator machine**: corpus generation (`say` + ffmpeg + `OPENAI_API_KEY`), feedback
  clips, keyword/harness tooling, evaluation, and packaging from the monorepo.

## GPU run (Linux worker)

On the pinned `livekit-wakeword` checkout, with `/data` and `/output` as persistent mounts and
this file's `scout-cascade.yaml` visible at `/workspace/scout-cascade.yaml`:

```bash
uv sync --all-extras
uv run livekit-wakeword setup --config /workspace/scout-cascade.yaml
uv run livekit-wakeword run /workspace/scout-cascade.yaml
```

The setup must include the complete ACAV100M 2,000-hour feature artifact. **Do not use
`--skip-acav`** — packaging rejects a checkout without the full ~13 GB feature file. The recipe
generates 40,000 training positives, 40,000 adversarial negatives (heavy on bare-"scout" and
homophones), 45,000 standalone backgrounds, validation splits, and two noisy augmentation
rounds. Never mount the formal synthetic or human holdouts into the worker. Select a threshold
using only the generated tuning split.

## Packaging (monorepo, macOS)

```bash
cd packages/streambot
bun run voice:verifier:package \
  --phrase-slug hey-scout \
  --livekit-dir ../../.context/livekit-wakeword \
  --model-dir <persistent-output>/hey_scout_cascade \
  --threshold <reviewed-threshold>
```

This writes `hey_scout.onnx`, `melspectrogram.onnx`, `embedding_model.onnx`,
`hey-scout-smoke.wav`, and `wake-verifier.json` into
`packages/scout-for-lol/packages/backend/assets/voice/` (override with `--dest`), verifying the
training corpus provenance counts and the full ACAV artifact first.

## Post-training acceptance (macOS)

1. Assemble an assets dir at `.context/scout-voice-models/`: the pinned sherpa base model +
   `silero_vad.onnx` + `test_wavs/` (copy from the `bun run voice:harness:prepare` export,
   dropping streambot's wake files) plus everything in `../assets/voice/`.
2. Generate and verify the 400-clip Scout corpus (~$1–5 of OpenAI TTS):

   ```bash
   bun run voice:corpus:generate --phrase hey-scout
   bun run voice:corpus:verify --phrase hey-scout
   ```

3. Evaluate **with the 2-hour negative soak** (a skipped soak records as failed):

   ```bash
   bun run voice:corpus:evaluate --phrase hey-scout --assets-dir ../../.context/scout-voice-models
   ```

   Commit the dated report to `reports/` in this directory and review it. Re-measure the `HEY`
   fragment tail and update `fragment-tails.json` if endpoint numbers demand it.

4. Human holdout — 3 speakers x 10 clips (5 positive / 3 near-match / 2 background), recordings
   kept under `.context/` and deleted by the tool after the aggregate report:

   ```bash
   bun run voice:human:evaluate --phrase hey-scout --input-dir ../../.context/<holdout-dir>
   ```

5. Regenerate Scout's spoken feedback clips when shipping — prefer OpenAI TTS output over the
   `say`-based `bun run scripts/voice-feedback-generate.ts --phrase hey-scout`.

## Acceptance criteria

Measured and operator-reviewed (streambot precedent: review inputs, not CI gates), on both the
native and WASM runtimes:

- clean-positive recall = 100%; stress recall at ≥ 10 dB SNR ≥ 95%
- zero negative-corpus activations and zero 2-hour soak activations
  (bare-"scout" false accepts are the number to scrutinize)
- zero endpoint violations (650–1500 ms after speech end)
- human holdout: 15/15 positives, 15/15 negatives, identical native/WASM classification

Packaging is not acceptance: the committed corpus report, untouched human holdout, and Scout's
own integration gates must still pass before the assets ship.
