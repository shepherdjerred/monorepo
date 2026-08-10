import path from "node:path";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";

const MIN_POSITIVES = 20_000;
const MIN_ADVERSARIAL = 40_000;
const GENERAL_NEGATIVE_HOURS = 2000;

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "livekit-dir": { type: "string" },
    "model-dir": { type: "string" },
    threshold: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(`Package an accepted LiveKit/openWakeWord verifier.

Usage:
  bun run voice:verifier:package --livekit-dir <checkout> --model-dir <run> --threshold <0..1>

The pinned checkout must contain the full ACAV100M feature asset. The command verifies training
counts, copies the mel/embedding/classifier ONNX graph atomically, and writes its checksum manifest.
It does not evaluate or select a threshold; pass the reviewed synthetic-tuning threshold.
`);
  process.exit(0);
}

const livekitDir = path.resolve(z.string().min(1).parse(values["livekit-dir"]));
const modelDir = path.resolve(z.string().min(1).parse(values["model-dir"]));
const threshold = z.coerce.number().min(0).max(1).parse(values.threshold);
const destination = path.resolve(import.meta.dir, "../assets/voice");
const temporary = path.join(destination, `.verifier-${crypto.randomUUID()}`);

async function countWaves(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".wav"),
  ).length;
}

async function firstWave(directory: string): Promise<string> {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const entries = directoryEntries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".wav"),
    )
    .map((entry) => entry.name)
    .sort();
  const filename = entries[0];
  if (filename === undefined) {
    throw new Error(`No verifier smoke WAV is available in ${directory}`);
  }
  return path.join(directory, filename);
}

async function sha256(filename: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(new Uint8Array(await Bun.file(filename).arrayBuffer()));
  return hasher.digest("hex");
}

const positives = await countWaves(path.join(modelDir, "positive_train"));
const adversarial = await countWaves(path.join(modelDir, "negative_train"));
if (positives < MIN_POSITIVES || adversarial < MIN_ADVERSARIAL) {
  throw new Error(
    `Training corpus is undersized: ${String(positives)} positives, ${String(adversarial)} adversarial negatives`,
  );
}
const acav = path.join(
  livekitDir,
  "data",
  "features",
  "openwakeword_features_ACAV100M_2000_hrs_16bit.npy",
);
if (!(await Bun.file(acav).exists())) {
  throw new Error(
    "The full ACAV100M general-speech feature asset is required; setup with --skip-acav is not acceptable",
  );
}
if (Bun.file(acav).size < 10 * 1024 * 1024 * 1024) {
  throw new Error(
    "The ACAV100M feature asset is undersized; package only the complete 2,000-hour artifact",
  );
}

const sources = {
  mel: path.join(
    livekitDir,
    "src/livekit/wakeword/resources/melspectrogram.onnx",
  ),
  embedding: path.join(
    livekitDir,
    "src/livekit/wakeword/resources/embedding_model.onnx",
  ),
  classifier: path.join(modelDir, "hey_streambot_cascade.onnx"),
  smokePositive: await firstWave(path.join(modelDir, "positive_test")),
};
for (const source of Object.values(sources)) {
  if (!(await Bun.file(source).exists())) {
    throw new Error(`Verifier asset is missing: ${source}`);
  }
}

await mkdir(temporary, { recursive: false });
try {
  const outputs = {
    mel: path.join(temporary, "melspectrogram.onnx"),
    embedding: path.join(temporary, "embedding_model.onnx"),
    classifier: path.join(temporary, "hey_streambot.onnx"),
    smokePositive: path.join(temporary, "hey-streambot-smoke.wav"),
  };
  await Promise.all([
    cp(sources.mel, outputs.mel),
    cp(sources.embedding, outputs.embedding),
    cp(sources.classifier, outputs.classifier),
    cp(sources.smokePositive, outputs.smokePositive),
  ]);
  const manifest = {
    version: 1,
    threshold,
    assets: {
      melspectrogram: await sha256(outputs.mel),
      embedding: await sha256(outputs.embedding),
      classifier: await sha256(outputs.classifier),
      smokePositive: await sha256(outputs.smokePositive),
    },
    training: {
      positiveUtterances: positives,
      adversarialUtterances: adversarial,
      generalNegativeHours: GENERAL_NEGATIVE_HOURS,
      humanHoldoutIncluded: false,
    },
  };
  await Bun.write(
    path.join(temporary, "wake-verifier.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const filename of [
    "melspectrogram.onnx",
    "embedding_model.onnx",
    "hey_streambot.onnx",
    "hey-streambot-smoke.wav",
    "wake-verifier.json",
  ]) {
    await rename(
      path.join(temporary, filename),
      path.join(destination, filename),
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write(
  `Packaged verifier with ${String(positives)} positives and ${String(adversarial)} adversarial negatives\n`,
);
