import { describe, expect, test } from "bun:test";
import type { GameSnapshot } from "#src/game/events/types.ts";
import type { ParsedPartyMon } from "#src/game/events/pokemon-struct.ts";
import {
  evaluateCatchBenchmark,
  type PersistedSaveEvidence,
} from "./benchmark-evaluator.ts";

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
const caught = mon(2, 263);
const initial = snapshot([starter], [251]);
const afterCatch = snapshot([starter, caught], [251, 262]);

function persisted(
  snapshotValue: GameSnapshot = afterCatch,
): PersistedSaveEvidence {
  return {
    persistedAt: "2026-07-28T10:06:00.000Z",
    byteLength: 128 * 1024,
    snapshot: snapshotValue,
  };
}

describe("evaluateCatchBenchmark", () => {
  test("requires event, live state, and persisted save evidence", () => {
    const result = evaluateCatchBenchmark({
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      initialSnapshot: initial,
      finalSnapshot: afterCatch,
      catchEvents: [{ occurredAt: CAUGHT_AT, species: 263 }],
      persistedSave: persisted(),
    });

    expect(result.success).toBe(true);
    expect(result.caughtSpecies).toEqual([263]);
    expect(result.evidence).toEqual({
      postStartCatch: true,
      livePartyAdded: true,
      liveDexIncreased: true,
      persistedPartyAdded: true,
      persistedDexIncreased: true,
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
      "live party and Pokédex contain no post-start catch evidence",
      "persisted party and Pokédex contain no catch evidence",
      "save was not persisted after the catch event",
    ]);
  });

  test("rejects a catch event from before the benchmark", () => {
    const result = evaluateCatchBenchmark({
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      initialSnapshot: initial,
      finalSnapshot: afterCatch,
      catchEvents: [{ occurredAt: "2026-07-28T09:59:59.000Z", species: 263 }],
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
      catchEvents: [{ occurredAt: CAUGHT_AT, species: 263 }],
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
});
