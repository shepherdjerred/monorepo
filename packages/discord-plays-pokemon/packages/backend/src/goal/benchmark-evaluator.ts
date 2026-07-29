// Strict, benchmark-only evidence evaluation. Runtime GoalStatus continues to
// follow the Codex process lifecycle; this module must never be called to
// decide whether a production /goal process is "completed".

import type { GameSnapshot } from "#src/game/events/types.ts";
import {
  dexOwned,
  hasNewPartyIdentity,
  nationalDexNumber,
  snapshotContainsSpeciesDelta,
  type CatchEventEvidence,
  type CatchStateEvidence,
} from "./catch-evidence.ts";

const EMERALD_FLASH_SAVE_BYTES = 128 * 1024;

export type PersistedSaveEvidence = {
  persistedAt: string;
  byteLength: number;
  snapshot: CatchStateEvidence;
};

export type CatchBenchmarkInput = {
  startedAt: string;
  finishedAt: string;
  initialSnapshot: GameSnapshot;
  finalSnapshot: GameSnapshot;
  evidenceCapturedFrame: number;
  catchEvents: readonly CatchEventEvidence[];
  persistedSave: PersistedSaveEvidence | null;
};

export type CatchBenchmarkEvidence = {
  postStartCatch: boolean;
  postEventSpeciesObserved: boolean;
  liveSpeciesCorrelated: boolean;
  persistedSpeciesCorrelated: boolean;
  exactSpeciesCorrelated: boolean;
  saveWrittenAfterCatch: boolean;
  saveSizeValid: boolean;
};

export type CatchBenchmarkResult = {
  objective: "catch-pokemon";
  success: boolean;
  caughtSpecies: readonly number[];
  verifiedCaughtSpecies: readonly number[];
  evidence: CatchBenchmarkEvidence;
  failures: readonly string[];
};

export type GoalBenchmarkTelemetry = {
  durationMs: number;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  movementActions: number;
  movementStops: number;
  repeatedPositionLoops: number;
  ignoredInputs: number;
  screenshots: number;
  knowledgeQueries: number;
  compactObservations: number;
  fullObservations: number;
  toolOutputCharacters: number;
  errors: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  estimatedCostUsd: number | null;
  traceId: string;
  saveSha256: string;
  wasmSha256: string;
  targetCommit: string;
  runnerCommit: string;
  model: string;
  reasoningEffort: string;
};

export type CatchBenchmarkArtifact = {
  evaluation: CatchBenchmarkResult;
  telemetry: GoalBenchmarkTelemetry;
};

export function evaluateCatchBenchmark(
  input: CatchBenchmarkInput,
): CatchBenchmarkResult {
  const startedAt = timestamp(input.startedAt, "startedAt");
  const finishedAt = timestamp(input.finishedAt, "finishedAt");
  if (finishedAt < startedAt) {
    throw new Error("finishedAt must not precede startedAt");
  }
  if (
    !Number.isInteger(input.evidenceCapturedFrame) ||
    input.evidenceCapturedFrame < 0
  ) {
    throw new Error("evidenceCapturedFrame must be a nonnegative integer");
  }

  const postStartEvents = input.catchEvents.filter((event) => {
    const occurredAt = timestamp(event.occurredAt, "catchEvents[].occurredAt");
    return (
      occurredAt >= startedAt && event.frame <= input.evidenceCapturedFrame
    );
  });
  const persistedSnapshot = input.persistedSave?.snapshot;
  const correlated = postStartEvents.map((event) => {
    const expectedNationalDexNumber = nationalDexNumber(event.species);
    if (event.nationalDexNumber !== expectedNationalDexNumber) {
      throw new Error(
        `catch event species ${String(event.species)} maps to National Dex ${String(expectedNationalDexNumber)}, not ${String(event.nationalDexNumber)}`,
      );
    }
    const postEventSpeciesObserved =
      hasNewPartyIdentity(
        input.initialSnapshot.party,
        event.postEventParty,
        event.species,
      ) ||
      (!dexOwned(input.initialSnapshot, expectedNationalDexNumber) &&
        event.postEventNationalDexOwned);
    const liveSpeciesCorrelated = snapshotContainsSpeciesDelta(
      input.initialSnapshot,
      input.finalSnapshot,
      event.species,
      expectedNationalDexNumber,
    );
    const persistedSpeciesCorrelated =
      persistedSnapshot !== undefined &&
      snapshotContainsSpeciesDelta(
        input.initialSnapshot,
        persistedSnapshot,
        event.species,
        expectedNationalDexNumber,
      );
    const saveWrittenAfterCatch =
      input.persistedSave !== null &&
      timestamp(input.persistedSave.persistedAt, "persistedSave.persistedAt") >=
        timestamp(event.occurredAt, "catchEvents[].occurredAt");
    return {
      event,
      postEventSpeciesObserved,
      liveSpeciesCorrelated,
      persistedSpeciesCorrelated,
      saveWrittenAfterCatch,
      exactSpeciesCorrelated:
        postEventSpeciesObserved &&
        liveSpeciesCorrelated &&
        persistedSpeciesCorrelated,
    };
  });
  const verified = correlated.filter(
    (entry) => entry.exactSpeciesCorrelated && entry.saveWrittenAfterCatch,
  );

  const saveWrittenAfterCatch =
    correlated.length > 0 &&
    correlated.every((entry) => entry.saveWrittenAfterCatch);
  const saveSizeValid =
    input.persistedSave?.byteLength === EMERALD_FLASH_SAVE_BYTES;

  const evidence: CatchBenchmarkEvidence = {
    postStartCatch: postStartEvents.length > 0,
    postEventSpeciesObserved: correlated.some(
      (entry) => entry.postEventSpeciesObserved,
    ),
    liveSpeciesCorrelated: correlated.some(
      (entry) => entry.liveSpeciesCorrelated,
    ),
    persistedSpeciesCorrelated: correlated.some(
      (entry) => entry.persistedSpeciesCorrelated,
    ),
    exactSpeciesCorrelated: correlated.some(
      (entry) => entry.exactSpeciesCorrelated,
    ),
    saveWrittenAfterCatch,
    saveSizeValid,
  };

  const failures: string[] = [];
  if (!evidence.postStartCatch) {
    failures.push("no catch event occurred during the benchmark window");
  }
  if (!evidence.postEventSpeciesObserved) {
    failures.push("catch event has no exact post-event species delta");
  }
  if (!evidence.liveSpeciesCorrelated) {
    failures.push("live state contains no delta for the caught species");
  }
  if (!evidence.persistedSpeciesCorrelated) {
    failures.push("persisted state contains no delta for the caught species");
  }
  if (
    evidence.postEventSpeciesObserved &&
    evidence.liveSpeciesCorrelated &&
    evidence.persistedSpeciesCorrelated &&
    !evidence.exactSpeciesCorrelated
  ) {
    failures.push(
      "catch event, live state, and persisted state do not correlate to one species",
    );
  }
  if (!evidence.saveWrittenAfterCatch) {
    failures.push("save was not persisted after the catch event");
  }
  if (!evidence.saveSizeValid) {
    failures.push("persisted save is not an Emerald 128 KiB flash image");
  }

  return {
    objective: "catch-pokemon",
    success: failures.length === 0,
    caughtSpecies: postStartEvents.map((event) => event.species),
    verifiedCaughtSpecies: verified.map((entry) => entry.event.species),
    evidence,
    failures,
  };
}

function timestamp(value: string, field: string): number {
  const result = Date.parse(value);
  if (Number.isNaN(result)) {
    throw new TypeError(`${field} must be an ISO timestamp`);
  }
  return result;
}
