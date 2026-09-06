// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- The sherpa runtimes ship no TypeScript declarations; ours live in sherpa-onnx.d.ts. A reference (unlike an import) makes those ambient declarations travel with this module when a consumer package typechecks it, while adding nothing for Bun to load at runtime.
/// <reference path="./sherpa-onnx.d.ts" />
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  WakeVerifierManifestSchema,
  type VoiceAssetManifest,
} from "./asset-manifest.ts";
import type { VoiceLogger } from "./ports.ts";
import {
  createWakePhraseVerifier,
  type WakePhraseVerification,
  type WakePhraseVerifier,
} from "./phrase-verifier.ts";
import { readPcm16MonoWave } from "./wave-io.ts";
import { z } from "zod";

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

function assetPaths(
  manifest: VoiceAssetManifest,
): Omit<AssetPaths, "wakeThreshold"> {
  const { assetsDir, files } = manifest;
  return {
    encoder: path.join(assetsDir, files.encoder),
    decoder: path.join(assetsDir, files.decoder),
    joiner: path.join(assetsDir, files.joiner),
    tokens: path.join(assetsDir, files.tokens),
    bpe: path.join(assetsDir, files.bpe),
    keywords: path.join(assetsDir, files.keywords),
    smokeKeywords: path.join(assetsDir, files.smokeKeywords),
    smokePositive: path.join(assetsDir, files.smokePositive),
    vad: path.join(assetsDir, files.vad),
    wakeMel: path.join(assetsDir, files.wakeMel),
    wakeEmbedding: path.join(assetsDir, files.wakeEmbedding),
    wakeClassifier: path.join(assetsDir, files.wakeClassifier),
    wakeSmokePositive: path.join(assetsDir, files.wakeSmokePositive),
    wakeManifest: path.join(assetsDir, files.wakeManifest),
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
    // The temporary runtime owns a full spotter (WASM frees it here; the smoke verifier's
    // close is a no-op) — leaking it per smoke would matter most under runtime "both".
    await models.close();
  }
  if (!activated) {
    throw new Error(
      `The ${runtime} keyword runtime loaded but failed its positive recognition fixture`,
    );
  }
}

export async function validateVoiceAssets(
  manifest: VoiceAssetManifest,
): Promise<AssetPaths> {
  const paths = assetPaths(manifest);
  const missing: string[] = [];
  for (const filename of Object.values(paths)) {
    if (!(await Bun.file(filename).exists())) {
      missing.push(filename);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Voice model assets missing: ${missing.join(", ")}`);
  }
  const wakeManifest = WakeVerifierManifestSchema.parse(
    await Bun.file(paths.wakeManifest).json(),
  );
  const checksums = await Promise.all([
    sha256(paths.wakeMel),
    sha256(paths.wakeEmbedding),
    sha256(paths.wakeClassifier),
    sha256(paths.wakeSmokePositive),
  ]);
  if (
    checksums[0] !== wakeManifest.assets.melspectrogram ||
    checksums[1] !== wakeManifest.assets.embedding ||
    checksums[2] !== wakeManifest.assets.classifier ||
    checksums[3] !== wakeManifest.assets.smokePositive
  ) {
    throw new Error("Wake verifier asset checksum verification failed");
  }
  return { ...paths, wakeThreshold: wakeManifest.threshold };
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
  manifest: VoiceAssetManifest,
  runtime: "native" | "wasm",
): Promise<LocalVoiceModels> {
  const assets = await validateVoiceAssets(manifest);
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

/**
 * Load and smoke-test the selected in-process local runtime. No model is downloaded here.
 * Whether voice is enabled at all is the consumer's boot decision — this always initializes.
 * "auto" tries native and falls back to WASM (logging the fallback); an explicit runtime never
 * falls back across runtimes.
 */
export async function initializeLocalVoiceModels(
  manifest: VoiceAssetManifest,
  runtime: "auto" | "native" | "wasm",
  logger: VoiceLogger,
): Promise<LocalVoiceModels> {
  if (runtime === "wasm") {
    return await initializeLocalVoiceModelsForRuntime(manifest, "wasm");
  }
  try {
    return await initializeLocalVoiceModelsForRuntime(manifest, "native");
  } catch (error) {
    if (runtime === "native") throw error;
    logger.warn("native sherpa-onnx smoke test failed; using in-process WASM", {
      error: error instanceof Error ? error.message : String(error),
    });
    return await initializeLocalVoiceModelsForRuntime(manifest, "wasm");
  }
}
