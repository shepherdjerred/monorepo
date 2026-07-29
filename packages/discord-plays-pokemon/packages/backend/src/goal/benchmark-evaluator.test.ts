import { describe, expect, test } from "bun:test";
import type { GameSnapshot } from "#src/game/events/types.ts";
import type { ParsedPartyMon } from "#src/game/events/pokemon-struct.ts";
import { BenchmarkWorkerResultSchema } from "./benchmark-harness.ts";
import {
  evaluateCatchBenchmark,
  type PersistedSaveEvidence,
} from "./benchmark-evaluator.ts";
import { evaluateWorkerCatch } from "./benchmark-result.ts";

const STARTED_AT = "2026-07-28T10:00:00.000Z";
const CAUGHT_AT = "2026-07-28T10:05:00.000Z";
const FINISHED_AT = "2026-07-28T10:10:00.000Z";

function mon(personality: number, species: number): ParsedPartyMon {
  return {
    personality,
    otId: 7,
    species,
    level: 5,
    hp: 20,
    maxHp: 20,
    isEgg: false,
    nickname: `MON-${String(personality)}`,
  };
}

function snapshot(
  party: readonly ParsedPartyMon[],
  ownedBits: readonly number[],
): GameSnapshot {
  const dexOwned = new Uint8Array(52);
  for (const bit of ownedBits) {
    const byteIndex = Math.floor(bit / 8);
    const byte = dexOwned[byteIndex];
    if (byte === undefined) {
      throw new Error(`owned bit ${String(bit)} is out of range`);
    }
    dexOwned[byteIndex] = byte | (1 << (bit % 8));
  }
  return {
    party,
    badges: Array.from({ length: 8 }, () => false),
    dexOwned,
    caughtMonSpecies: 0,
    caughtMonShiny: false,
  };
}

const starter = mon(1, 277);
const caught = mon(2, 288);
const initial = snapshot([starter], [251]);
const afterCatch = snapshot([starter, caught], [251, 262]);

function catchEvent(
  values: {
    occurredAt?: string;
    species?: number;
    nationalDexNumber?: number;
    postEventParty?: readonly ParsedPartyMon[];
    postEventNationalDexOwned?: boolean;
  } = {},
) {
  return {
    occurredAt: values.occurredAt ?? CAUGHT_AT,
    frame: 18_000,
    species: values.species ?? 288,
    nationalDexNumber: values.nationalDexNumber ?? 263,
    postEventParty: (values.postEventParty ?? afterCatch.party).map(
      (entry) => ({
        personality: entry.personality,
        otId: entry.otId,
        species: entry.species,
      }),
    ),
    postEventNationalDexOwned: values.postEventNationalDexOwned ?? true,
  };
}

function persisted(
  snapshotValue: GameSnapshot = afterCatch,
): PersistedSaveEvidence {
  return {
    persistedAt: "2026-07-28T10:06:00.000Z",
    byteLength: 128 * 1024,
    snapshot: snapshotValue,
  };
}

function serializeSnapshot(snapshotValue: GameSnapshot) {
  return {
    party: snapshotValue.party,
    badges: [...snapshotValue.badges],
    dexOwned: [...snapshotValue.dexOwned],
    caughtMonSpecies: snapshotValue.caughtMonSpecies,
    caughtMonShiny: snapshotValue.caughtMonShiny,
  };
}

describe("evaluateCatchBenchmark", () => {
  test("requires event, live state, and persisted save evidence", () => {
    const result = evaluateCatchBenchmark({
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      initialSnapshot: initial,
      finalSnapshot: afterCatch,
      catchEvents: [catchEvent()],
      persistedSave: persisted(),
    });

    expect(result.success).toBe(true);
    expect(result.caughtSpecies).toEqual([288]);
    expect(result.verifiedCaughtSpecies).toEqual([288]);
    expect(result.evidence).toEqual({
      postStartCatch: true,
      postEventSpeciesObserved: true,
      liveSpeciesCorrelated: true,
      persistedSpeciesCorrelated: true,
      exactSpeciesCorrelated: true,
      saveWrittenAfterCatch: true,
      saveSizeValid: true,
    });
    expect(result.failures).toEqual([]);
  });

  test("does not accept Codex prose or process completion as evidence", () => {
    const result = evaluateCatchBenchmark({
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      initialSnapshot: initial,
      finalSnapshot: initial,
      catchEvents: [],
      persistedSave: persisted(initial),
    });

    expect(result.success).toBe(false);
    expect(result.failures).toEqual([
      "no catch event occurred during the benchmark window",
      "catch event has no exact post-event species delta",
      "live state contains no delta for the caught species",
      "persisted state contains no delta for the caught species",
      "save was not persisted after the catch event",
    ]);
  });

  test("rejects a catch event from before the benchmark", () => {
    const result = evaluateCatchBenchmark({
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      initialSnapshot: initial,
      finalSnapshot: afterCatch,
      catchEvents: [catchEvent({ occurredAt: "2026-07-28T09:59:59.000Z" })],
      persistedSave: persisted(),
    });

    expect(result.success).toBe(false);
    expect(result.evidence.postStartCatch).toBe(false);
    expect(result.failures).toContain(
      "no catch event occurred during the benchmark window",
    );
  });

  test("rejects a save written before the catch", () => {
    const result = evaluateCatchBenchmark({
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      initialSnapshot: initial,
      finalSnapshot: afterCatch,
      catchEvents: [catchEvent()],
      persistedSave: {
        ...persisted(),
        persistedAt: "2026-07-28T10:04:59.000Z",
      },
    });

    expect(result.success).toBe(false);
    expect(result.evidence.saveWrittenAfterCatch).toBe(false);
    expect(result.failures).toContain(
      "save was not persisted after the catch event",
    );
  });

  test("rejects unrelated party and Dex increases for another species", () => {
    const result = evaluateCatchBenchmark({
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      initialSnapshot: initial,
      finalSnapshot: afterCatch,
      catchEvents: [
        catchEvent({
          species: 286,
          nationalDexNumber: 261,
          postEventParty: afterCatch.party,
          postEventNationalDexOwned: false,
        }),
      ],
      persistedSave: persisted(),
    });

    expect(result.success).toBe(false);
    expect(result.verifiedCaughtSpecies).toEqual([]);
    expect(result.evidence).toEqual({
      postStartCatch: true,
      postEventSpeciesObserved: false,
      liveSpeciesCorrelated: false,
      persistedSpeciesCorrelated: false,
      exactSpeciesCorrelated: false,
      saveWrittenAfterCatch: true,
      saveSizeValid: true,
    });
  });

  test("correlates an exact species through its National Dex bit", () => {
    const dexOnlyAfterCatch = snapshot([starter], [251, 262]);
    const result = evaluateCatchBenchmark({
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      initialSnapshot: initial,
      finalSnapshot: dexOnlyAfterCatch,
      catchEvents: [
        catchEvent({
          postEventParty: [starter],
          postEventNationalDexOwned: true,
        }),
      ],
      persistedSave: persisted(dexOnlyAfterCatch),
    });

    expect(result.success).toBe(true);
    expect(result.verifiedCaughtSpecies).toEqual([288]);
  });

  test("rejects a claimed National Dex number that does not map to species", () => {
    expect(() =>
      evaluateCatchBenchmark({
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        initialSnapshot: initial,
        finalSnapshot: afterCatch,
        catchEvents: [catchEvent({ nationalDexNumber: 261 })],
        persistedSave: persisted(),
      }),
    ).toThrow("maps to National Dex 263, not 261");
  });

  test("rejects malformed chronology instead of guessing", () => {
    expect(() =>
      evaluateCatchBenchmark({
        startedAt: FINISHED_AT,
        finishedAt: STARTED_AT,
        initialSnapshot: initial,
        finalSnapshot: afterCatch,
        catchEvents: [],
        persistedSave: null,
      }),
    ).toThrow("finishedAt must not precede startedAt");
  });

  test("does not trust the target decoder for persisted catch evidence", () => {
    const workerResult = BenchmarkWorkerResultSchema.parse({
      schemaVersion: 1,
      goalState: {
        id: "goal-1",
        goal: "catch a Pokemon",
        requestedBy: "benchmark",
        startedAt: STARTED_AT,
        status: "completed",
        finishedAt: FINISHED_AT,
        exitCode: 0,
      },
      initialSnapshot: serializeSnapshot(initial),
      finalSnapshot: serializeSnapshot(afterCatch),
      catchEvents: [catchEvent()],
      persistedSave: {
        persistedAt: "2026-07-28T10:06:00.000Z",
        byteLength: 128 * 1024,
        snapshot: serializeSnapshot(afterCatch),
      },
    });

    const result = evaluateWorkerCatch({
      workerResult,
      providerFailure: null,
      persistedSnapshot: initial,
    });

    expect(result?.success).toBe(false);
    expect(result?.evidence.persistedSpeciesCorrelated).toBe(false);
    expect(result?.failures).toContain(
      "persisted state contains no delta for the caught species",
    );
  });
});
