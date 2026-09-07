import path from "node:path";
import type { ReceivedVoiceAudio } from "@shepherdjerred/discord-video-stream";
import {
  loadVoiceCorpusManifest,
  verifyVoiceCorpus,
} from "@shepherdjerred/streambot/voice/corpus-io.ts";
import type {
  VoiceCorpusEntry,
  VoiceCorpusManifest,
} from "@shepherdjerred/streambot/voice/corpus-schema.ts";
import {
  decodeDiscordOpusContainer,
  VoiceAudioLifecycle,
  type LocalVoiceModels,
} from "@shepherdjerred/voice-assistant";
import type { VoiceAudioLifecycleOptions } from "@shepherdjerred/voice-assistant/audio-lifecycle-types.ts";
import { initializeLocalVoiceModelsForRuntime } from "@shepherdjerred/voice-assistant/local-models.ts";
import { streambotVoiceLifecycleDeps } from "@shepherdjerred/streambot/voice/local-voice.ts";
import {
  VOICE_WAKE_PHRASES,
  type VoiceWakePhraseProfile,
} from "@shepherdjerred/streambot/voice/corpus-phrases.ts";
import { VOICE_WAKE_WINDOW_MS } from "@shepherdjerred/voice-assistant/constants.ts";

/** The lifecycle ports the offline evaluator injects; phrase-specific via the profile. */
export type VoiceLifecycleDeps = Pick<
  VoiceAudioLifecycleOptions,
  "fragmentTailMs" | "metrics" | "observability"
>;

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
  /** Null when the soak was skipped — a skipped soak must never read as a passed one. */
  readonly twoHourNegativeSoakActivations: number | null;
};

export type VoiceCorpusEvaluationReport = {
  readonly version: 1;
  readonly evaluatedAt: string;
  readonly corpusClips: number;
  readonly native: RuntimeCorpusEvaluation;
  readonly wasm: RuntimeCorpusEvaluation;
  /**
   * Clip ids where the native and WASM runtimes disagreed on activation. Report-only:
   * production runs one runtime, each runtime is independently gated by every threshold, and
   * bit-level float parity between onnxruntime builds is build trivia, not acceptance evidence.
   */
  readonly runtimeDisagreements: readonly string[];
  readonly passed: boolean;
};

export function cloneDiscordOpusPackets(
  packets: readonly Uint8Array[],
): Uint8Array[] {
  return packets.map((packet) => Uint8Array.from(packet));
}

function audio(opus: Uint8Array, index: number): ReceivedVoiceAudio {
  return { userId: "synthetic-speaker", ssrc: 1000 + index, opus };
}

/**
 * The phrase verifier resolves asynchronously while `accept()` is synchronous, so offline
 * evaluation has to be able to wait for a scheduled verification to finish being applied.
 * Every caller needs it for the same reason — a turn that is still pending when the feed stops
 * is silently discarded by `close()`.
 */
/**
 * Offline evaluation is packet-clocked and clips carry their own recorded silence; the wall-clock
 * DTX ticker would inject extra silence whenever ONNX inference ran slow, making measured
 * endpoints a property of machine speed instead of the audio.
 */
function inertSilenceTickerStop(): void {
  /* nothing to stop: the inert ticker never started anything */
}

function inertSilenceTicker(): () => void {
  return inertSilenceTickerStop;
}

function verificationBarrier(): {
  readonly onScheduled: (settled: Promise<void>) => void;
  readonly settle: () => Promise<void>;
} {
  const running: { verification: Promise<void> | null } = {
    verification: null,
  };
  return {
    onScheduled: (settled) => {
      running.verification = settled;
    },
    settle: async () => {
      // A verification can schedule another as it settles, so drain until none is in flight.
      while (running.verification !== null) {
        const inFlight = running.verification;
        await inFlight;
        if (running.verification === inFlight) running.verification = null;
      }
    },
  };
}

export async function evaluateDiscordOpusPackets(
  models: LocalVoiceModels,
  packets: readonly Uint8Array[],
  lifecycleDeps: VoiceLifecycleDeps = streambotVoiceLifecycleDeps(),
): Promise<DiscordOpusPipelineEvaluation> {
  let activated = false;
  const candidate = { detected: false };
  const failure: { error: unknown } = { error: null };
  let packetTimeMs = 0;
  let endpointMs: number | null = null;
  // Draining the whole clip first would advance the simulated clock through the fixture's
  // trailing silence before the turn could complete, so every activation would report the clip's
  // end as its endpoint instead of the lifecycle's. Holding the feed for the verifier keeps the
  // simulated timestamp on the frame the turn actually completed at.
  const verification = verificationBarrier();
  const lifecycle = new VoiceAudioLifecycle({
    ...lifecycleDeps,
    models,
    preRollMs: VOICE_WAKE_WINDOW_MS,
    maxUtteranceMs: 15_000,
    createSilenceTicker: inertSilenceTicker,
    onCandidate: () => {
      candidate.detected = true;
    },
    onLocalVerificationScheduled: verification.onScheduled,
    onLocalVerificationError: (error) => {
      failure.error = error;
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
      await verification.settle();
    }
    lifecycle.finishInput();
    await verification.settle();
    await Bun.sleep(0);
  } finally {
    lifecycle.close();
  }
  if (failure.error !== null) {
    throw failure.error instanceof Error
      ? failure.error
      : new Error("Local wake verification failed", { cause: failure.error });
  }
  return { candidate: candidate.detected, activated, endpointMs };
}

async function evaluateClip(
  models: LocalVoiceModels,
  entry: VoiceCorpusEntry,
  packets: readonly Uint8Array[],
  lifecycleDeps: VoiceLifecycleDeps,
): Promise<ClipEvaluation> {
  const result = await evaluateDiscordOpusPackets(
    models,
    packets,
    lifecycleDeps,
  );
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
  lifecycleDeps: VoiceLifecycleDeps,
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
  const verification = verificationBarrier();
  const lifecycle = new VoiceAudioLifecycle({
    ...lifecycleDeps,
    models,
    preRollMs: VOICE_WAKE_WINDOW_MS,
    maxUtteranceMs: 15_000,
    createSilenceTicker: inertSilenceTicker,
    onLocalVerificationScheduled: verification.onScheduled,
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
      const packets = cloneDiscordOpusPackets(fixture.container.packets);
      for (const [packetIndex, packet] of packets.entries()) {
        lifecycle.accept(audio(packet, packetIndex));
        // Hold the simulated feed for any in-flight verification, exactly like the per-clip
        // path: otherwise a slow ONNX pass lets the loop fast-forward whole fixtures past a
        // pending candidate, and the soak under-drives the verifier it exists to measure.
        await verification.settle();
        elapsedMs += 20;
        if (elapsedMs >= targetMs) break;
      }
      await Bun.sleep(0);
      fixtureIndex += 17;
    }
    // A candidate raised near the cutoff — especially inside the last provisional window — is
    // still pending here, and `close()` discards a pending turn without ever reporting it. That
    // would drop a false activation and let the soak report zero, which is the one number this
    // gate exists to trust. Finalize the bounded input, then wait for the verification it starts.
    lifecycle.finishInput();
    await verification.settle();
    await Bun.sleep(0);
  } finally {
    lifecycle.close();
  }
  return activations;
}

type RuntimeEvaluationInputs = {
  readonly corpusDir: string;
  readonly manifest: VoiceCorpusManifest;
  readonly models: LocalVoiceModels;
  readonly runSoak: boolean;
  readonly lifecycleDeps: VoiceLifecycleDeps;
};

async function evaluateRuntime({
  corpusDir,
  manifest,
  models,
  runSoak,
  lifecycleDeps,
}: RuntimeEvaluationInputs): Promise<RuntimeCorpusEvaluation> {
  const clips: ClipEvaluation[] = [];
  for (const entry of manifest.entries) {
    const container = decodeDiscordOpusContainer(
      new Uint8Array(
        await Bun.file(path.join(corpusDir, entry.file)).arrayBuffer(),
      ),
    );
    clips.push(
      await evaluateClip(models, entry, container.packets, lifecycleDeps),
    );
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
      ? await negativeSoak(corpusDir, models, manifest, lifecycleDeps)
      : null,
  };
}

export async function evaluateVoiceCorpus(options: {
  readonly corpusDir?: string;
  readonly assetsDir: string;
  readonly runSoak?: boolean;
  /** Which wake phrase's corpus/assets to evaluate; defaults to streambot's. */
  readonly phrase?: VoiceWakePhraseProfile;
}): Promise<VoiceCorpusEvaluationReport> {
  const phrase = options.phrase ?? VOICE_WAKE_PHRASES["hey-streambot"];
  const corpusDir = options.corpusDir ?? phrase.corpusDir;
  await verifyVoiceCorpus(corpusDir, true, phrase.spec);
  const manifest = await loadVoiceCorpusManifest(corpusDir, phrase.spec.format);
  const streambotDeps = streambotVoiceLifecycleDeps();
  // The metrics/observability ports are phrase-agnostic offline instrumentation; only the
  // fragment-tail table is phrase-specific.
  const lifecycleDeps: VoiceLifecycleDeps = {
    ...streambotDeps,
    fragmentTailMs: await phrase.loadFragmentTailMs(),
  };
  const assetManifest = phrase.assetManifest(options.assetsDir);
  const nativeModels = await initializeLocalVoiceModelsForRuntime(
    assetManifest,
    "native",
  );
  const wasmModels = await initializeLocalVoiceModelsForRuntime(
    assetManifest,
    "wasm",
  );
  let native: RuntimeCorpusEvaluation;
  let wasm: RuntimeCorpusEvaluation;
  try {
    native = await evaluateRuntime({
      corpusDir,
      manifest,
      models: nativeModels,
      runSoak: options.runSoak ?? true,
      lifecycleDeps,
    });
    wasm = await evaluateRuntime({
      corpusDir,
      manifest,
      models: wasmModels,
      runSoak: options.runSoak ?? true,
      lifecycleDeps,
    });
  } finally {
    await Promise.all([nativeModels.close(), wasmModels.close()]);
  }
  const runtimeDisagreements = native.clips
    .filter(
      (result, index) => result.activated !== wasm.clips[index]?.activated,
    )
    .map((result) => result.id);
  return {
    version: 1,
    evaluatedAt: new Date().toISOString(),
    corpusClips: manifest.entries.length,
    native,
    wasm,
    runtimeDisagreements,
    passed: passesRuntime(native) && passesRuntime(wasm),
  };
}

function passesRuntime(result: RuntimeCorpusEvaluation): boolean {
  return (
    result.cleanPositiveRecall === 1 &&
    result.negativeActivations === 0 &&
    result.stressAtLeast10DbRecall >= 0.95 &&
    result.endpointViolations.length === 0 &&
    result.twoHourNegativeSoakActivations === 0 // null (skipped) fails
  );
}
