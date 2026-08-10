# Streambot phrase-verifier training

The production classifier is trained with LiveKit's openWakeWord-compatible pipeline at commit
`95448a7559c453fcd87645bd67b247ffb45f85b0`. The checked-in
`streambot-cascade.yaml` is the canonical recipe. Its `/data` and `/output` paths are intended to
be persistent mounts on a Linux GPU worker; the formal synthetic holdout and private human
holdout must never be mounted into that worker.

On the pinned LiveKit checkout, install the training extras and run:

```bash
uv sync --all-extras
uv run livekit-wakeword setup --config /workspace/streambot-cascade.yaml
uv run livekit-wakeword run /workspace/streambot-cascade.yaml
```

The setup must include the complete ACAV100M 2,000-hour feature artifact. Do not use
`--skip-acav`. The recipe generates 40,000 training positives, 40,000 adversarial negatives,
45,000 standalone backgrounds, additional validation splits, and two noisy augmentation rounds.
Use an external GPU worker; running the full 100,000-step job is deliberately not part of normal
CI.

Select a threshold using only the generated tuning split. Then package the accepted classifier
from the monorepo:

```bash
cd packages/streambot
bun run voice:verifier:package \
  --livekit-dir ../../.context/livekit-wakeword \
  --model-dir <persistent-output>/hey_streambot_cascade \
  --threshold <reviewed-threshold>
```

Packaging fails unless the source corpus meets the minimum provenance counts and the full ACAV
artifact is present. It checksum-pins the mel, embedding, classifier, and a generated positive
smoke WAV. Voice-enabled startup then requires both native and WASM runtimes to accept that smoke
fixture. Packaging is not acceptance: the canonical corpus, untouched human holdout, Linux image,
and live Discord gates must still pass.
