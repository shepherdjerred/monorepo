import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { validateVoiceAssets } from "@shepherdjerred/streambot/voice/local-models.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function sha256(filename: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(new Uint8Array(await Bun.file(filename).arrayBuffer()));
  return hasher.digest("hex");
}

async function fixture(): Promise<string> {
  const directory = await mkdtemp(
    path.join(import.meta.dir, ".voice-assets-test-"),
  );
  temporaryDirectories.push(directory);
  const files = [
    "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "tokens.txt",
    "bpe.model",
    "hey-streambot.txt",
    "silero_vad.onnx",
    "melspectrogram.onnx",
    "embedding_model.onnx",
    "hey_streambot.onnx",
    "hey-streambot-smoke.wav",
  ];
  await Promise.all(
    files.map((filename, index) =>
      Bun.write(path.join(directory, filename), `asset-${String(index)}`),
    ),
  );
  await Bun.write(path.join(directory, "test_wavs", "test_keywords.txt"), "x");
  await Bun.write(path.join(directory, "test_wavs", "0.wav"), "x");
  const manifest = {
    version: 1,
    threshold: 0.73,
    assets: {
      melspectrogram: await sha256(path.join(directory, "melspectrogram.onnx")),
      embedding: await sha256(path.join(directory, "embedding_model.onnx")),
      classifier: await sha256(path.join(directory, "hey_streambot.onnx")),
      smokePositive: await sha256(
        path.join(directory, "hey-streambot-smoke.wav"),
      ),
    },
    training: {
      positiveUtterances: 20_000,
      adversarialUtterances: 40_000,
      generalNegativeHours: 25,
      humanHoldoutIncluded: false,
    },
  };
  await Bun.write(
    path.join(directory, "wake-verifier.json"),
    JSON.stringify(manifest),
  );
  return directory;
}

describe("voice verifier assets", () => {
  test("accepts checksum-pinned assets with the minimum training provenance", async () => {
    const directory = await fixture();
    const assets = await validateVoiceAssets(directory);
    expect(assets.wakeThreshold).toBe(0.73);
  });

  test("rejects a changed classifier and undersized training provenance", async () => {
    const changed = await fixture();
    await Bun.write(path.join(changed, "hey_streambot.onnx"), "changed");
    await expect(validateVoiceAssets(changed)).rejects.toThrow("checksum");

    const undersized = await fixture();
    const manifestPath = path.join(undersized, "wake-verifier.json");
    const manifest = await Bun.file(manifestPath).json();
    if (typeof manifest !== "object" || manifest === null) {
      throw new Error("Expected fixture manifest object");
    }
    const training = Reflect.get(manifest, "training");
    if (typeof training !== "object" || training === null) {
      throw new Error("Expected fixture training object");
    }
    Reflect.set(training, "positiveUtterances", 19_999);
    await Bun.write(manifestPath, JSON.stringify(manifest));
    await expect(validateVoiceAssets(undersized)).rejects.toThrow();
  });
});
