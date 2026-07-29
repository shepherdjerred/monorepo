// Strict, benchmark-only evidence evaluation. Runtime GoalStatus continues to
// follow the Codex process lifecycle; this module must never be called to
// decide whether a production /goal process is "completed".

import type { GameSnapshot } from "#src/game/events/types.ts";

const EMERALD_FLASH_SAVE_BYTES = 128 * 1024;

export type CatchEventEvidence = {
  occurredAt: string;
  species: number;
};

export type PersistedSaveEvidence = {
  persistedAt: string;
  byteLength: number;
  snapshot: GameSnapshot;
};

export type CatchBenchmarkInput = {
  startedAt: string;
  finishedAt: string;
  initialSnapshot: GameSnapshot;
  finalSnapshot: GameSnapshot;
  catchEvents: readonly CatchEventEvidence[];
  persistedSave: PersistedSaveEvidence | null;
};

export type CatchBenchmarkEvidence = {
  postStartCatch: boolean;
  livePartyAdded: boolean;
  liveDexIncreased: boolean;
  persistedPartyAdded: boolean;
  persistedDexIncreased: boolean;
  saveWrittenAfterCatch: boolean;
  saveSizeValid: boolean;
};

export type CatchBenchmarkResult = {
  objective: "catch-pokemon";
  success: boolean;
  caughtSpecies: readonly number[];
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
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  estimatedCostUsd: number;
  traceId: string;
  saveSha256: string;
  wasmCommit: string;
  gitCommit: string;
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

  const postStartEvents = input.catchEvents.filter((event) => {
    const occurredAt = timestamp(event.occurredAt, "catchEvents[].occurredAt");
    return occurredAt >= startedAt && occurredAt <= finishedAt;
  });
  const latestCatchAt =
    postStartEvents.length === 0
      ? undefined
      : Math.max(
          ...postStartEvents.map((event) =>
            timestamp(event.occurredAt, "catchEvents[].occurredAt"),
          ),
        );

  const livePartyAdded = hasNewPartyMember(
    input.initialSnapshot,
    input.finalSnapshot,
  );
  const liveDexIncreased =
    ownedCount(input.finalSnapshot.dexOwned) >
    ownedCount(input.initialSnapshot.dexOwned);

  const persistedSnapshot = input.persistedSave?.snapshot;
  const persistedPartyAdded =
    persistedSnapshot === undefined
      ? false
      : hasNewPartyMember(input.initialSnapshot, persistedSnapshot);
  const persistedDexIncreased =
    persistedSnapshot === undefined
      ? false
      : ownedCount(persistedSnapshot.dexOwned) >
        ownedCount(input.initialSnapshot.dexOwned);
  const saveWrittenAfterCatch =
    latestCatchAt !== undefined &&
    input.persistedSave !== null &&
    timestamp(input.persistedSave.persistedAt, "persistedSave.persistedAt") >=
      latestCatchAt;
  const saveSizeValid =
    input.persistedSave?.byteLength === EMERALD_FLASH_SAVE_BYTES;

  const evidence: CatchBenchmarkEvidence = {
    postStartCatch: postStartEvents.length > 0,
    livePartyAdded,
    liveDexIncreased,
    persistedPartyAdded,
    persistedDexIncreased,
    saveWrittenAfterCatch,
    saveSizeValid,
  };

  const failures: string[] = [];
  if (!evidence.postStartCatch) {
    failures.push("no catch event occurred during the benchmark window");
  }
  if (!evidence.livePartyAdded && !evidence.liveDexIncreased) {
    failures.push(
      "live party and Pokédex contain no post-start catch evidence",
    );
  }
  if (!evidence.persistedPartyAdded && !evidence.persistedDexIncreased) {
    failures.push("persisted party and Pokédex contain no catch evidence");
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
    evidence,
    failures,
  };
}

function hasNewPartyMember(
  initial: GameSnapshot,
  candidate: GameSnapshot,
): boolean {
  const initialIdentities = new Set(
    initial.party.map(
      (mon) => `${String(mon.personality)}:${String(mon.otId)}`,
    ),
  );
  return candidate.party.some(
    (mon) =>
      !initialIdentities.has(`${String(mon.personality)}:${String(mon.otId)}`),
  );
}

function ownedCount(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    let remaining = byte;
    while (remaining !== 0) {
      count += remaining & 1;
      remaining >>>= 1;
    }
  }
  return count;
}

function timestamp(value: string, field: string): number {
  const result = Date.parse(value);
  if (Number.isNaN(result)) {
    throw new TypeError(`${field} must be an ISO timestamp`);
  }
  return result;
}
