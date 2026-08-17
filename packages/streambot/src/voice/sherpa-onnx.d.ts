declare module "sherpa-onnx-node" {
  export type SherpaTransducerConfig = {
    encoder: string;
    decoder: string;
    joiner: string;
  };

  export type SherpaModelConfig = {
    transducer: SherpaTransducerConfig;
    tokens: string;
    numThreads: number;
    provider: "cpu";
    debug: number;
    modelingUnit: "bpe";
    bpeVocab: string;
  };

  export type KeywordSpotterConfig = {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: SherpaModelConfig;
    maxActivePaths: number;
    numTrailingBlanks: number;
    keywordsScore: number;
    keywordsThreshold: number;
    keywordsFile: string;
  };

  export type VadConfig = {
    sileroVad: {
      model: string;
      threshold: number;
      minSilenceDuration: number;
      minSpeechDuration: number;
      windowSize: number;
      maxSpeechDuration: number;
    };
    sampleRate: number;
    numThreads: number;
    provider: "cpu";
    debug: number;
  };

  export class OnlineStream {
    acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
  }

  export class KeywordSpotter {
    constructor(config: KeywordSpotterConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): {
      start_time: number;
      keyword: string;
      timestamps: number[];
      tokens: string[];
    };
  }

  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    pop(): void;
    clear(): void;
    reset(): void;
    flush(): void;
  }
}

declare module "sherpa-onnx" {
  import type {
    KeywordSpotterConfig,
    SherpaModelConfig,
    VadConfig,
  } from "sherpa-onnx-node";

  export type WasmKeywordSpotterConfig = Omit<
    KeywordSpotterConfig,
    "keywordsFile" | "featConfig"
  > & {
    featConfig: { samplingRate: number; featureDim: number };
    modelConfig: SherpaModelConfig;
    keywords: string;
  };

  export type WasmStream = {
    acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
    free: () => void;
  };

  export type WasmKeywordSpotter = {
    createStream: () => WasmStream;
    isReady: (stream: WasmStream) => boolean;
    decode: (stream: WasmStream) => void;
    reset: (stream: WasmStream) => void;
    getResult: (stream: WasmStream) => { keyword: string };
    free: () => void;
  };

  export type WasmVad = {
    acceptWaveform: (samples: Float32Array) => void;
    isEmpty: () => boolean;
    isDetected: () => boolean;
    pop: () => void;
    clear: () => void;
    reset: () => void;
    flush: () => void;
    free: () => void;
  };

  export function createKws(
    config: WasmKeywordSpotterConfig,
  ): WasmKeywordSpotter;
  export function createVad(
    config: VadConfig & { bufferSizeInSeconds: number },
  ): WasmVad;
}
