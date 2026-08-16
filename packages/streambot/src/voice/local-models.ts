import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  createWakePhraseVerifier,
  type WakePhraseVerification,
  type WakePhraseVerifier,
} from "@shepherdjerred/streambot/voice/phrase-verifier.ts";
import { readPcm16MonoWave } from "@shepherdjerred/streambot/voice/wave-io.ts";

const log = logger.child("voice-models");
const SAMPLE_RATE = 16_000;

export type KeywordDetector = {
  accept: (samples: Float32Array) => KeywordDetectionEvidence | null;
  reset: () => void;
  close: () => void;
};

export type KeywordDetectionEvidence = {
  readonly detector: "sherpa";
  readonly phrase: string;
  /** sherpa's streaming KWS result does not expose its internal confidence. */
  readonly score: number | null;
  /**
   * When the matched fragment's last token began, in seconds since this detector's stream was last
   * reset. sherpa emits a decision well AFTER the audio it matched (~280 ms on the packaged smoke
   * fixture, and variable with decoder state), so emission time cannot locate the phrase. This
   * timestamp can: it lets the lifecycle close the verification window a fixed distance past the
   * audio itself rather than past the decision. `null` when the runtime reports no timestamps.
   */
  readonly fragmentEndSeconds: number | null;
};

export type VoiceActivityDetector = {
  accept: (samples: Float32Array) => void;
  isSpeechActive: () => boolean;
  hasCompletedSpeech: () => boolean;
  flush: () => void;
  reset: () => void;
  close: () => void;
};

export type LocalVoiceModels = {
  runtime: "native" | "wasm";
  createKeywordDetector: () => KeywordDetector;
  createVad: () => VoiceActivityDetector;
  verifyWakePhrase: (samples: Float32Array) => Promise<WakePhraseVerification>;
  close: () => Promise<void>;
};

type AssetPaths = {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
  bpe: string;
  keywords: string;
  smokeKeywords: string;
  smokePositive: string;
  vad: string;
  wakeMel: string;
  wakeEmbedding: string;
  wakeClassifier: string;
  wakeSmokePositive: string;
  wakeManifest: string;
  wakeThreshold: number;
};

const WakeVerifierManifestSchema = z.strictObject({
  version: z.literal(1),
  threshold: z.number().min(0).max(1),
  assets: z.strictObject({
    melspectrogram: z.string().regex(/^[a-f0-9]{64}$/u),
    embedding: z.string().regex(/^[a-f0-9]{64}$/u),
    classifier: z.string().regex(/^[a-f0-9]{64}$/u),
    smokePositive: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  training: z.strictObject({
    positiveUtterances: z.number().int().min(20_000),
    adversarialUtterances: z.number().int().min(40_000),
    generalNegativeHours: z.number().min(25),
    humanHoldoutIncluded: z.literal(false),
  }),
});

function assetPaths(assetsDir: string): Omit<AssetPaths, "wakeThreshold"> {
  return {
    encoder: path.join(
      assetsDir,
      "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    ),
    decoder: path.join(
      assetsDir,
      "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    ),
    joiner: path.join(
      assetsDir,
      "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    ),
    tokens: path.join(assetsDir, "tokens.txt"),
    bpe: path.join(assetsDir, "bpe.model"),
    keywords: path.join(assetsDir, "hey-streambot.txt"),
    smokeKeywords: path.join(assetsDir, "test_wavs", "test_keywords.txt"),
    smokePositive: path.join(assetsDir, "test_wavs", "0.wav"),
    vad: path.join(assetsDir, "silero_vad.onnx"),
    wakeMel: path.join(assetsDir, "melspectrogram.onnx"),
    wakeEmbedding: path.join(assetsDir, "embedding_model.onnx"),
    wakeClassifier: path.join(assetsDir, "hey_streambot.onnx"),
    wakeSmokePositive: path.join(assetsDir, "hey-streambot-smoke.wav"),
    wakeManifest: path.join(assetsDir, "wake-verifier.json"),
  };
}

async function sha256(filename: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(new Uint8Array(await Bun.file(filename).arrayBuffer()));
  return hasher.digest("hex");
}

const smokeVerifier: WakePhraseVerifier = {
  verify: () => Promise.resolve({ accepted: true, score: 1 }),
  close: () => Promise.resolve(),
};

async function assertKeywordRuntimeWorks(
  assets: AssetPaths,
  runtime: "native" | "wasm",
): Promise<void> {
  const smokeAssets = { ...assets, keywords: assets.smokeKeywords };
  const models =
    runtime === "native"
      ? await createNativeModels(smokeAssets, smokeVerifier)
      : await createWasmModels(smokeAssets, smokeVerifier);
  const detector = models.createKeywordDetector();
  const wave = await readPcm16MonoWave(assets.smokePositive);
  if (wave.sampleRate !== SAMPLE_RATE) {
    detector.close();
    throw new Error(
      `Keyword smoke WAV must be ${String(SAMPLE_RATE)} Hz: ${assets.smokePositive}`,
    );
  }
  let activated = false;
  try {
    const chunkSamples = SAMPLE_RATE / 50;
    for (let offset = 0; offset < wave.samples.length; offset += chunkSamples) {
      if (
        detector.accept(
          wave.samples.subarray(offset, offset + chunkSamples),
        ) !== null
      ) {
        activated = true;
        break;
      }
    }
    if (!activated) {
      const silence = new Float32Array(Math.ceil(SAMPLE_RATE * 0.66));
      for (let offset = 0; offset < silence.length; offset += chunkSamples) {
        if (
          detector.accept(silence.subarray(offset, offset + chunkSamples)) !==
          null
        ) {
          activated = true;
          break;
        }
      }
      silence.fill(0);
    }
  } finally {
    wave.samples.fill(0);
    detector.close();
  }
  if (!activated) {
    throw new Error(
      `The ${runtime} keyword runtime loaded but failed its positive recognition fixture`,
    );
  }
}

export async function validateVoiceAssets(
  assetsDir: string,
): Promise<AssetPaths> {
  const paths = assetPaths(assetsDir);
  const missing: string[] = [];
  for (const filename of Object.values(paths)) {
    if (!(await Bun.file(filename).exists())) {
      missing.push(filename);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Voice model assets missing: ${missing.join(", ")}`);
  }
  const manifest = WakeVerifierManifestSchema.parse(
    await Bun.file(paths.wakeManifest).json(),
  );
  const checksums = await Promise.all([
    sha256(paths.wakeMel),
    sha256(paths.wakeEmbedding),
    sha256(paths.wakeClassifier),
    sha256(paths.wakeSmokePositive),
  ]);
  if (
    checksums[0] !== manifest.assets.melspectrogram ||
    checksums[1] !== manifest.assets.embedding ||
    checksums[2] !== manifest.assets.classifier ||
    checksums[3] !== manifest.assets.smokePositive
  ) {
    throw new Error("Wake verifier asset checksum verification failed");
  }
  return { ...paths, wakeThreshold: manifest.threshold };
}

/**
 * Last token start time from a sherpa KWS result, or null when the runtime reports none.
 * The raw JSON carries `timestamps` (seconds, stream-relative) alongside `tokens`; both native and
 * WASM return the same shape, and neither is typed by its bindings.
 */
const KeywordTimestampsSchema = z.looseObject({
  timestamps: z.array(z.number()).min(1),
});

function fragmentEndSeconds(result: unknown): number | null {
  const parsed = KeywordTimestampsSchema.safeParse(result);
  if (!parsed.success) return null;
  return parsed.data.timestamps.at(-1) ?? null;
}

function modelConfig(assets: AssetPaths) {
  return {
    transducer: {
      encoder: assets.encoder,
      decoder: assets.decoder,
      joiner: assets.joiner,
    },
    tokens: assets.tokens,
    numThreads: 1,
    provider: "cpu" as const,
    debug: 0,
    modelingUnit: "bpe" as const,
    bpeVocab: assets.bpe,
  };
}

function vadConfig(assets: AssetPaths) {
  return {
    sileroVad: {
      model: assets.vad,
      threshold: 0.5,
      minSilenceDuration: 0.65,
      minSpeechDuration: 0.2,
      windowSize: 512,
      maxSpeechDuration: 15,
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: "cpu" as const,
    debug: 0,
  };
}

async function createNativeModels(
  assets: AssetPaths,
  verifier: WakePhraseVerifier,
): Promise<LocalVoiceModels> {
  const { KeywordSpotter, Vad } = await import("sherpa-onnx-node");
  const kwsConfig = {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: modelConfig(assets),
    maxActivePaths: 8,
    numTrailingBlanks: 1,
    keywordsScore: 2,
    keywordsThreshold: 0.05,
    keywordsFile: assets.keywords,
  };
  // One spotter per models instance: constructing it loads the full transducer model, and the
  // lifecycle discards every speaker's detector on each candidate/turn/rejection. sherpa-onnx-node
  // exposes no free/dispose API, so per-speaker spotters churned model-sized native allocations
  // reclaimable only by NAPI finalizers. Per-speaker state lives in streams, which are cheap.
  const spotter = new KeywordSpotter(kwsConfig);
  return {
    runtime: "native",
    createKeywordDetector: () => {
      const stream = spotter.createStream();
      return {
        accept: (samples) => {
          stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
          while (spotter.isReady(stream)) spotter.decode(stream);
          const result = spotter.getResult(stream);
          if (result.keyword.length === 0) return null;
          spotter.reset(stream);
          return {
            detector: "sherpa",
            phrase: result.keyword,
            score: null,
            fragmentEndSeconds: fragmentEndSeconds(result),
          };
        },
        reset: () => {
          spotter.reset(stream);
        },
        close: () => {
          // No native stream disposal API; the small stream's NAPI finalizer reclaims it at GC.
        },
      };
    },
    createVad: () => {
      const vad = new Vad(vadConfig(assets), 30);
      return {
        accept: (samples) => {
          vad.acceptWaveform(samples);
        },
        isSpeechActive: () => vad.isDetected(),
        hasCompletedSpeech: () => !vad.isEmpty(),
        flush: () => {
          vad.flush();
        },
        reset: () => {
          vad.reset();
        },
        close: () => {
          vad.clear();
        },
      };
    },
    verifyWakePhrase: verifier.verify,
    close: verifier.close,
  };
}

async function createWasmModels(
  assets: AssetPaths,
  verifier: WakePhraseVerifier,
): Promise<LocalVoiceModels> {
  const { createKws, createVad } = await import("sherpa-onnx");
  const keywords = await readFile(assets.keywords, "utf8");
  // Mirror of the native runtime: one model-sized spotter per models instance, cheap per-speaker
  // streams. The WASM heap does expose free(), so the shared spotter is released in close().
  const spotter = createKws({
    featConfig: { samplingRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: modelConfig(assets),
    maxActivePaths: 8,
    numTrailingBlanks: 1,
    keywordsScore: 2,
    keywordsThreshold: 0.05,
    keywords,
  });
  return {
    runtime: "wasm",
    createKeywordDetector: () => {
      const stream = spotter.createStream();
      return {
        accept: (samples) => {
          stream.acceptWaveform(SAMPLE_RATE, samples);
          while (spotter.isReady(stream)) spotter.decode(stream);
          const result = spotter.getResult(stream);
          if (result.keyword.length === 0) return null;
          spotter.reset(stream);
          return {
            detector: "sherpa",
            phrase: result.keyword,
            score: null,
            fragmentEndSeconds: fragmentEndSeconds(result),
          };
        },
        reset: () => {
          spotter.reset(stream);
        },
        close: () => {
          stream.free();
        },
      };
    },
    createVad: () => {
      const vad = createVad({ ...vadConfig(assets), bufferSizeInSeconds: 30 });
      return {
        accept: (samples) => {
          vad.acceptWaveform(samples);
        },
        isSpeechActive: () => vad.isDetected(),
        hasCompletedSpeech: () => !vad.isEmpty(),
        flush: () => {
          vad.flush();
        },
        reset: () => {
          vad.reset();
        },
        close: () => {
          vad.free();
        },
      };
    },
    verifyWakePhrase: verifier.verify,
    close: async () => {
      spotter.free();
      await verifier.close();
    },
  };
}

/** Explicit runtime selection for corpus/image acceptance; never falls back across runtimes. */
export async function initializeLocalVoiceModelsForRuntime(
  assetsDir: string,
  runtime: "native" | "wasm",
): Promise<LocalVoiceModels> {
  const assets = await validateVoiceAssets(assetsDir);
  await assertKeywordRuntimeWorks(assets, runtime);
  const verifier = await createWakePhraseVerifier(
    {
      mel: assets.wakeMel,
      embedding: assets.wakeEmbedding,
      classifier: assets.wakeClassifier,
    },
    assets.wakeThreshold,
  );
  try {
    const models =
      runtime === "native"
        ? await createNativeModels(assets, verifier)
        : await createWasmModels(assets, verifier);
    const verifierSmoke = await readPcm16MonoWave(assets.wakeSmokePositive);
    try {
      if (verifierSmoke.sampleRate !== SAMPLE_RATE) {
        throw new Error(
          `Wake verifier smoke WAV must be ${String(SAMPLE_RATE)} Hz`,
        );
      }
      const result = await models.verifyWakePhrase(verifierSmoke.samples);
      if (!result.accepted) {
        throw new Error(
          `The ${runtime} wake verifier rejected its positive smoke fixture`,
        );
      }
    } finally {
      verifierSmoke.samples.fill(0);
    }
    models.createKeywordDetector().close();
    models.createVad().close();
    return models;
  } catch (error) {
    await verifier.close();
    throw error;
  }
}

/** Load and smoke-test the selected in-process local runtime. No model is downloaded here. */
export async function initializeLocalVoiceModels(
  config: Config["voice"],
): Promise<LocalVoiceModels | null> {
  if (!config.enabled) return null;
  if (config.runtime === "wasm") {
    return await initializeLocalVoiceModelsForRuntime(config.assetsDir, "wasm");
  }
  try {
    return await initializeLocalVoiceModelsForRuntime(
      config.assetsDir,
      "native",
    );
  } catch (error) {
    if (config.runtime === "native") throw error;
    log.warn("native sherpa-onnx smoke test failed; using in-process WASM", {
      error: error instanceof Error ? error.message : String(error),
    });
    return await initializeLocalVoiceModelsForRuntime(config.assetsDir, "wasm");
  }
}
