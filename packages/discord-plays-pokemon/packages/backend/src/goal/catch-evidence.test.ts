import { describe, expect, test } from "bun:test";
import type { ParsedPartyMon } from "#src/game/events/pokemon-struct.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";
import {
  CATCH_EVIDENCE_SETTLE_MAX_FRAMES,
  CATCH_EVIDENCE_SETTLE_MAX_MS,
  createCatchEvidenceSettler,
} from "./catch-evidence.ts";

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
const poochyena = mon(2, 286);
const zigzagoon = mon(3, 288);
const initial = snapshot([starter], [251]);

describe("benchmark catch evidence settling", () => {
  test("waits for a delayed exact party and Pokedex delta", () => {
    const settler = createCatchEvidenceSettler(initial);
    settler.observe({
      frame: 100,
      capturedAtMs: 1000,
      snapshot: initial,
      catches: [
        {
          occurredAt: "2026-07-29T10:00:00.000Z",
          species: 288,
        },
      ],
    });
    settler.observe({
      frame: 130,
      capturedAtMs: 1500,
      snapshot: initial,
      catches: [],
    });
    settler.observe({
      frame: 160,
      capturedAtMs: 2000,
      snapshot: snapshot([starter, zigzagoon], [251, 262]),
      catches: [],
    });

    expect(settler.pendingCount()).toBe(0);
    expect(settler.finish()).toEqual([
      {
        occurredAt: "2026-07-29T10:00:00.000Z",
        frame: 100,
        species: 288,
        nationalDexNumber: 263,
        postEventParty: [
          { personality: 1, otId: 7, species: 277 },
          { personality: 3, otId: 7, species: 288 },
        ],
        postEventNationalDexOwned: true,
      },
    ]);
  });

  test("closes older evidence before a later unrelated catch sample", () => {
    const settler = createCatchEvidenceSettler(initial);
    settler.observe({
      frame: 100,
      capturedAtMs: 1000,
      snapshot: initial,
      catches: [
        {
          occurredAt: "2026-07-29T10:00:00.000Z",
          species: 286,
        },
      ],
    });
    settler.observe({
      frame: 130,
      capturedAtMs: 1500,
      snapshot: snapshot([starter, poochyena, zigzagoon], [251, 260, 262]),
      catches: [
        {
          occurredAt: "2026-07-29T10:00:00.500Z",
          species: 288,
        },
      ],
    });

    expect(settler.finish()).toEqual([
      {
        occurredAt: "2026-07-29T10:00:00.000Z",
        frame: 100,
        species: 286,
        nationalDexNumber: 261,
        postEventParty: [{ personality: 1, otId: 7, species: 277 }],
        postEventNationalDexOwned: false,
      },
      {
        occurredAt: "2026-07-29T10:00:00.500Z",
        frame: 130,
        species: 288,
        nationalDexNumber: 263,
        postEventParty: [
          { personality: 1, otId: 7, species: 277 },
          { personality: 2, otId: 7, species: 286 },
          { personality: 3, otId: 7, species: 288 },
        ],
        postEventNationalDexOwned: true,
      },
    ]);
  });

  test("does not accept matching evidence after either timeout bound", () => {
    const matchingSnapshot = snapshot([starter, zigzagoon], [251, 262]);
    const evidenceAfter = (
      frame: number,
      capturedAtMs: number,
    ): ReturnType<ReturnType<typeof createCatchEvidenceSettler>["finish"]> => {
      const settler = createCatchEvidenceSettler(initial);
      settler.observe({
        frame: 100,
        capturedAtMs: 1000,
        snapshot: initial,
        catches: [
          {
            occurredAt: "2026-07-29T10:00:00.000Z",
            species: 288,
          },
        ],
      });
      settler.observe({
        frame,
        capturedAtMs,
        snapshot: matchingSnapshot,
        catches: [],
      });
      expect(settler.pendingCount()).toBe(0);
      return settler.finish();
    };

    const frameExpired = evidenceAfter(
      100 + CATCH_EVIDENCE_SETTLE_MAX_FRAMES + 1,
      1500,
    );
    const wallTimeExpired = evidenceAfter(
      130,
      1000 + CATCH_EVIDENCE_SETTLE_MAX_MS + 1,
    );
    const expected = {
      occurredAt: "2026-07-29T10:00:00.000Z",
      frame: 100,
      species: 288,
      nationalDexNumber: 263,
      postEventParty: [{ personality: 1, otId: 7, species: 277 }],
      postEventNationalDexOwned: false,
    };

    expect(frameExpired[0]).toEqual(expected);
    expect(wallTimeExpired[0]).toEqual(expected);
  });

  test("finish records bounded negative evidence without another sample", () => {
    const settler = createCatchEvidenceSettler(initial);
    settler.observe({
      frame: 100,
      capturedAtMs: 1000,
      snapshot: initial,
      catches: [
        {
          occurredAt: "2026-07-29T10:00:00.000Z",
          species: 288,
        },
      ],
    });

    expect(settler.pendingCount()).toBe(1);
    expect(settler.finish()[0]).toEqual({
      occurredAt: "2026-07-29T10:00:00.000Z",
      frame: 100,
      species: 288,
      nationalDexNumber: 263,
      postEventParty: [{ personality: 1, otId: 7, species: 277 }],
      postEventNationalDexOwned: false,
    });
  });
});
