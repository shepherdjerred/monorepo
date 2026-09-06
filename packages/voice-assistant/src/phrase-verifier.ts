import * as ort from "onnxruntime-node";

const SAMPLE_RATE = 16_000;
const VERIFIER_WINDOW_SAMPLES = SAMPLE_RATE * 2;
const MEL_WINDOW_FRAMES = 76;
const MEL_BINS = 32;
const MEL_STRIDE_FRAMES = 8;
const EMBEDDING_SIZE = 96;
const CLASSIFIER_FRAMES = 16;

export type WakePhraseVerification = {
  readonly accepted: boolean;
  readonly score: number;
};

export type WakePhraseVerifier = {
  readonly verify: (samples: Float32Array) => Promise<WakePhraseVerification>;
  readonly close: () => Promise<void>;
};

export type WakePhraseVerifierAssets = {
  readonly mel: string;
  readonly embedding: string;
  readonly classifier: string;
};

function onlyName(names: readonly string[], model: string): string {
  const name = names[0];
  if (name === undefined || names.length !== 1) {
    throw new Error(`${model} must expose exactly one input and one output`);
  }
  return name;
}

function floatOutput(
  outputs: ort.InferenceSession.ReturnType,
  name: string,
  model: string,
): Float32Array {
  const tensor = outputs[name];
  if (tensor === undefined || !(tensor.data instanceof Float32Array)) {
    throw new Error(`${model} returned an invalid float output`);
  }
  return tensor.data;
}

function verifierWindow(samples: Float32Array): Float32Array {
  const window = new Float32Array(VERIFIER_WINDOW_SAMPLES);
  if (samples.length >= window.length) {
    window.set(samples.subarray(samples.length - window.length));
  } else {
    window.set(samples, window.length - samples.length);
  }
  return window;
}

/**
 * LiveKit/openWakeWord-compatible mel -> embedding -> phrase classifier graph.
 * All model handles stay in-process and every request-owned feature buffer is erased.
 */
export async function createWakePhraseVerifier(
  assets: WakePhraseVerifierAssets,
  threshold: number,
): Promise<WakePhraseVerifier> {
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["cpu"],
    interOpNumThreads: 1,
    intraOpNumThreads: 1,
  };
  const [melSession, embeddingSession, classifierSession] = await Promise.all([
    ort.InferenceSession.create(assets.mel, options),
    ort.InferenceSession.create(assets.embedding, options),
    ort.InferenceSession.create(assets.classifier, options),
  ]);
  const melInput = onlyName(melSession.inputNames, "mel model");
  const melOutput = onlyName(melSession.outputNames, "mel model");
  const embeddingInput = onlyName(
    embeddingSession.inputNames,
    "embedding model",
  );
  const embeddingOutput = onlyName(
    embeddingSession.outputNames,
    "embedding model",
  );
  const classifierInput = onlyName(
    classifierSession.inputNames,
    "wake classifier",
  );
  const classifierOutput = onlyName(
    classifierSession.outputNames,
    "wake classifier",
  );
  let closed = false;

  return {
    verify: async (samples) => {
      if (closed) throw new Error("Wake phrase verifier is closed");
      const audio = verifierWindow(samples);
      let normalizedMel: Float32Array | null = null;
      let embeddingBatch: Float32Array | null = null;
      let classifierFeatures: Float32Array | null = null;
      let melOutputData: Float32Array | null = null;
      let embeddingOutputData: Float32Array | null = null;
      let classifierOutputData: Float32Array | null = null;
      try {
        const melFeeds: Record<string, ort.Tensor> = {
          [melInput]: new ort.Tensor("float32", audio, [1, audio.length]),
        };
        const melResult = await melSession.run(melFeeds);
        const mel = floatOutput(melResult, melOutput, "mel model");
        melOutputData = mel;
        if (mel.length < MEL_WINDOW_FRAMES * MEL_BINS) {
          throw new Error("Mel model returned too few feature frames");
        }
        normalizedMel = new Float32Array(mel.length);
        for (const [index, value] of mel.entries()) {
          normalizedMel[index] = value / 10 + 2;
        }
        const melFrames = Math.floor(mel.length / MEL_BINS);
        const windows =
          Math.floor((melFrames - MEL_WINDOW_FRAMES) / MEL_STRIDE_FRAMES) + 1;
        if (windows < CLASSIFIER_FRAMES) {
          throw new Error("Mel model returned too few embedding windows");
        }
        embeddingBatch = new Float32Array(
          windows * MEL_WINDOW_FRAMES * MEL_BINS,
        );
        for (let windowIndex = 0; windowIndex < windows; windowIndex += 1) {
          const sourceStart = windowIndex * MEL_STRIDE_FRAMES * MEL_BINS;
          const sourceEnd = sourceStart + MEL_WINDOW_FRAMES * MEL_BINS;
          embeddingBatch.set(
            normalizedMel.subarray(sourceStart, sourceEnd),
            windowIndex * MEL_WINDOW_FRAMES * MEL_BINS,
          );
        }
        const embeddingFeeds: Record<string, ort.Tensor> = {
          [embeddingInput]: new ort.Tensor("float32", embeddingBatch, [
            windows,
            MEL_WINDOW_FRAMES,
            MEL_BINS,
            1,
          ]),
        };
        const embeddingResult = await embeddingSession.run(embeddingFeeds);
        const embeddings = floatOutput(
          embeddingResult,
          embeddingOutput,
          "embedding model",
        );
        embeddingOutputData = embeddings;
        if (embeddings.length !== windows * EMBEDDING_SIZE) {
          throw new Error("Embedding model returned an invalid feature shape");
        }
        classifierFeatures = new Float32Array(
          CLASSIFIER_FRAMES * EMBEDDING_SIZE,
        );
        classifierFeatures.set(
          embeddings.subarray(
            embeddings.length - classifierFeatures.length,
            embeddings.length,
          ),
        );
        const classifierFeeds: Record<string, ort.Tensor> = {
          [classifierInput]: new ort.Tensor("float32", classifierFeatures, [
            1,
            CLASSIFIER_FRAMES,
            EMBEDDING_SIZE,
          ]),
        };
        const classifierResult = await classifierSession.run(classifierFeeds);
        const scores = floatOutput(
          classifierResult,
          classifierOutput,
          "wake classifier",
        );
        classifierOutputData = scores;
        const score = scores[0];
        if (score === undefined || !Number.isFinite(score)) {
          throw new Error("Wake classifier returned an invalid score");
        }
        return { accepted: score >= threshold, score };
      } finally {
        audio.fill(0);
        normalizedMel?.fill(0);
        embeddingBatch?.fill(0);
        classifierFeatures?.fill(0);
        melOutputData?.fill(0);
        embeddingOutputData?.fill(0);
        classifierOutputData?.fill(0);
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all([
        melSession.release(),
        embeddingSession.release(),
        classifierSession.release(),
      ]);
    },
  };
}
