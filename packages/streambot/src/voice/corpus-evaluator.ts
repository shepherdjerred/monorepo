import path from "node:path";
import type { ReceivedVoiceAudio } from "@shepherdjerred/discord-video-stream";
import {
  DEFAULT_VOICE_CORPUS_DIR,
  loadVoiceCorpusManifest,
  verifyVoiceCorpus,
} from "@shepherdjerred/streambot/voice/corpus-io.ts";
import type {
  VoiceCorpusEntry,
  VoiceCorpusManifest,
} from "@shepherdjerred/streambot/voice/corpus-schema.ts";
import { decodeDiscordOpusContainer } from "@shepherdjerred/streambot/voice/discord-opus-container.ts";
import { VoiceAudioLifecycle } from "@shepherdjerred/streambot/voice/audio-lifecycle.ts";
import {
  initializeLocalVoiceModelsForRuntime,
  type LocalVoiceModels,
} from "@shepherdjerred/streambot/voice/local-models.ts";
import { VOICE_WAKE_WINDOW_MS } from "@shepherdjerred/streambot/voice/constants.ts";

type ClipEvaluation = {
  readonly id: string;
  readonly expected: VoiceCorpusEntry["expected"];
  readonly activated: boolean;
  readonly candidate: boolean;
  readonly endpointDelayMs: number | null;
};

export type DiscordOpusPipelineEvaluation = {
  readonly candidate: boolean;
  readonly activated: boolean;
  readonly endpointMs: number | null;
};

export type ConfusionMatrix = {
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly trueNegative: number;
  readonly falseNegative: number;
};

export type RuntimeCorpusEvaluation = {
  readonly runtime: "native" | "wasm";
  readonly clips: readonly ClipEvaluation[];
  readonly sherpaCandidateRate: number;
  readonly sherpaCandidateConfusion: ConfusionMatrix;
  readonly localVerifierConfusion: ConfusionMatrix;
  readonly cleanPositiveRecall: number;
  readonly stressAtLeast10DbRecall: number;
  readonly stressBelow10DbRecall: number;
  readonly negativeActivations: number;
  readonly endpointViolations: readonly string[];
  readonly twoHourNegativeSoakActivations: number;
};

export type VoiceCorpusEvaluationReport = {
  readonly version: 1;
  readonly evaluatedAt: string;
  readonly corpusClips: number;
  readonly native: RuntimeCorpusEvaluation;
  readonly wasm: RuntimeCorpusEvaluation;
  readonly identicalClassifications: boolean;
  readonly passed: boolean;
};

function audio(opus: Uint8Array, index: number): ReceivedVoiceAudio {
  return { userId: "synthetic-speaker", ssrc: 1000 + index, opus };
}

export async function evaluateDiscordOpusPackets(
  models: LocalVoiceModels,
  packets: readonly Uint8Array[],
): Promise<DiscordOpusPipelineEvaluation> {
  let activated = false;
  const candidate = { detected: false };
  let packetTimeMs = 0;
  let endpointMs: number | null = null;
  const localDecision = Promise.withResolvers<undefined>();
  const lifecycle = new VoiceAudioLifecycle({
    models,
    preRollMs: VOICE_WAKE_WINDOW_MS,
    maxUtteranceMs: 15_000,
    onCandidate: () => {
      candidate.detected = true;
    },
    onLocalVerification: () => {
      localDecision.resolve(undefined);
    },
    onLocalVerificationError: (error) => {
      localDecision.reject(error);
    },
    onWake: () => {
      activated = true;
    },
    onTurn: (turn) => {
      turn.pcm16k.fill(0);
      endpointMs = packetTimeMs;
      return Promise.resolve();
    },
  });
  try {
    for (const [index, packet] of packets.entries()) {
      packetTimeMs = (index + 1) * 20;
      lifecycle.accept(audio(packet, index));
    }
    lifecycle.finishInput();
    if (candidate.detected) await localDecision.promise;
    await Bun.sleep(0);
  } finally {
    lifecycle.close();
  }
  return { candidate: candidate.detected, activated, endpointMs };
}

async function evaluateClip(
  models: LocalVoiceModels,
  entry: VoiceCorpusEntry,
  packets: readonly Uint8Array[],
): Promise<ClipEvaluation> {
  const result = await evaluateDiscordOpusPackets(models, packets);
  return {
    id: entry.id,
    expected: entry.expected,
    candidate: result.candidate,
    activated: result.activated,
    endpointDelayMs:
      result.endpointMs === null || entry.speechEndMs === null
        ? null
        : result.endpointMs - entry.speechEndMs,
  };
}

function confusion(
  results: readonly ClipEvaluation[],
  detected: (result: ClipEvaluation) => boolean,
): ConfusionMatrix {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  for (const result of results) {
    const positive = result.expected === "wake";
    const actual = detected(result);
    if (positive && actual) truePositive += 1;
    else if (positive) falseNegative += 1;
    else if (actual) falsePositive += 1;
    else trueNegative += 1;
  }
  return { truePositive, falsePositive, trueNegative, falseNegative };
}

function recall(results: readonly ClipEvaluation[]): number {
  if (results.length === 0) return 1;
  return results.filter((result) => result.activated).length / results.length;
}

async function negativeSoak(
  corpusDir: string,
  models: LocalVoiceModels,
  manifest: VoiceCorpusManifest,
): Promise<number> {
  const negatives = manifest.entries.filter(
    (entry) => entry.expected === "no-wake",
  );
  if (negatives.length === 0)
    throw new Error("Voice corpus has no negative fixtures");
  const decoded = await Promise.all(
    negatives.map(async (entry) => ({
      entry,
      container: decodeDiscordOpusContainer(
        new Uint8Array(
          await Bun.file(path.join(corpusDir, entry.file)).arrayBuffer(),
        ),
      ),
    })),
  );
  let activations = 0;
  const lifecycle = new VoiceAudioLifecycle({
    models,
    preRollMs: VOICE_WAKE_WINDOW_MS,
    maxUtteranceMs: 15_000,
    onWake: () => {
      activations += 1;
    },
    onTurn: (turn) => {
      turn.pcm16k.fill(0);
      return Promise.resolve();
    },
  });
  const targetMs = 2 * 60 * 60 * 1000;
  let elapsedMs = 0;
  let fixtureIndex = 0;
  try {
    while (elapsedMs < targetMs) {
      const fixture = decoded[fixtureIndex % decoded.length];
      if (fixture === undefined)
        throw new Error("Negative fixture selection failed");
      for (const [packetIndex, packet] of fixture.container.packets.entries()) {
        lifecycle.accept(audio(packet, packetIndex));
        elapsedMs += 20;
        if (elapsedMs >= targetMs) break;
      }
      await Bun.sleep(0);
      fixtureIndex += 17;
    }
    await Bun.sleep(0);
  } finally {
    lifecycle.close();
  }
  return activations;
}

async function evaluateRuntime(
  corpusDir: string,
  manifest: VoiceCorpusManifest,
  models: LocalVoiceModels,
  runSoak: boolean,
): Promise<RuntimeCorpusEvaluation> {
  const clips: ClipEvaluation[] = [];
  for (const entry of manifest.entries) {
    const container = decodeDiscordOpusContainer(
      new Uint8Array(
        await Bun.file(path.join(corpusDir, entry.file)).arrayBuffer(),
      ),
    );
    clips.push(await evaluateClip(models, entry, container.packets));
  }
  const byId = new Map(clips.map((result) => [result.id, result]));
  const clean = manifest.entries
    .filter((entry) => entry.category === "clean-positive")
    .map((entry) => byId.get(entry.id))
    .filter((result) => result !== undefined);
  const stressHigh = manifest.entries
    .filter(
      (entry) =>
        entry.category === "stress-positive" &&
        entry.augmentation.snrDb !== null &&
        entry.augmentation.snrDb >= 10,
    )
    .map((entry) => byId.get(entry.id))
    .filter((result) => result !== undefined);
  const stressLow = manifest.entries
    .filter(
      (entry) =>
        entry.category === "stress-positive" &&
        entry.augmentation.snrDb !== null &&
        entry.augmentation.snrDb < 10,
    )
    .map((entry) => byId.get(entry.id))
    .filter((result) => result !== undefined);
  const endpointViolations = manifest.entries
    .filter((entry) => entry.expected === "wake" && entry.speechEndMs !== null)
    .filter((entry) => {
      const delay = byId.get(entry.id)?.endpointDelayMs;
      return (
        delay === null || delay === undefined || delay < 650 || delay > 1500
      );
    })
    .map((entry) => entry.id);
  return {
    runtime: models.runtime,
    clips,
    sherpaCandidateRate:
      clips.length === 0
        ? 0
        : clips.filter((result) => result.candidate).length / clips.length,
    sherpaCandidateConfusion: confusion(clips, (result) => result.candidate),
    localVerifierConfusion: confusion(clips, (result) => result.activated),
    cleanPositiveRecall: recall(clean),
    stressAtLeast10DbRecall: recall(stressHigh),
    stressBelow10DbRecall: recall(stressLow),
    negativeActivations: clips.filter(
      (result) => result.expected === "no-wake" && result.activated,
    ).length,
    endpointViolations,
    twoHourNegativeSoakActivations: runSoak
      ? await negativeSoak(corpusDir, models, manifest)
      : 0,
  };
}

export async function evaluateVoiceCorpus(options: {
  readonly corpusDir?: string;
  readonly assetsDir: string;
  readonly runSoak?: boolean;
}): Promise<VoiceCorpusEvaluationReport> {
  const corpusDir = options.corpusDir ?? DEFAULT_VOICE_CORPUS_DIR;
  await verifyVoiceCorpus(corpusDir);
  const manifest = await loadVoiceCorpusManifest(corpusDir);
  const nativeModels = await initializeLocalVoiceModelsForRuntime(
    options.assetsDir,
    "native",
  );
  const wasmModels = await initializeLocalVoiceModelsForRuntime(
    options.assetsDir,
    "wasm",
  );
  let native: RuntimeCorpusEvaluation;
  let wasm: RuntimeCorpusEvaluation;
  try {
    native = await evaluateRuntime(
      corpusDir,
      manifest,
      nativeModels,
      options.runSoak ?? true,
    );
    wasm = await evaluateRuntime(
      corpusDir,
      manifest,
      wasmModels,
      options.runSoak ?? true,
    );
  } finally {
    await Promise.all([nativeModels.close(), wasmModels.close()]);
  }
  const identicalClassifications = native.clips.every(
    (result, index) => result.activated === wasm.clips[index]?.activated,
  );
  return {
    version: 1,
    evaluatedAt: new Date().toISOString(),
    corpusClips: manifest.entries.length,
    native,
    wasm,
    identicalClassifications,
    passed:
      identicalClassifications && passesRuntime(native) && passesRuntime(wasm),
  };
}

function passesRuntime(result: RuntimeCorpusEvaluation): boolean {
  return (
    result.cleanPositiveRecall === 1 &&
    result.negativeActivations === 0 &&
    result.stressAtLeast10DbRecall >= 0.95 &&
    result.endpointViolations.length === 0 &&
    result.twoHourNegativeSoakActivations === 0
  );
}
