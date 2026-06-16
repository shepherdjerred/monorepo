import { describe, expect, test } from "bun:test";
import type { GameSnapshot } from "#src/game/events/types.ts";
import type { SpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import { formatGameStateForPrompt } from "./game-state-summary.ts";

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    party: [],
    badges: Array.from({ length: 8 }, () => false),
    dexOwned: new Uint8Array(52),
    caughtMonSpecies: 0,
    caughtMonShiny: false,
    ...overrides,
  };
}

function spatial(overrides: Partial<SpatialSnapshot> = {}): SpatialSnapshot {
  return {
    x: 8,
    y: 5,
    facing: "south",
    movementMode: "on foot",
    mapGroup: 1,
    mapNum: 4,
    onTileBehavior: "normal floor",
    nearby: [],
    ...overrides,
  };
}

describe("formatGameStateForPrompt", () => {
  test("null snapshot renders an explicit unavailable line", () => {
    expect(formatGameStateForPrompt(null)).toBe(
      "Game state unavailable (no save loaded or mid-relocation).",
    );
  });

  test("empty party + no badges + no catches → bare summary", () => {
    const out = formatGameStateForPrompt(snapshot());
    expect(out).toBe(
      [
        "Party: empty",
        "Badges (0/8): none",
        "Pokédex owned: 0",
        "Last caught: none recorded this session",
      ].join("\n"),
    );
  });

  test("party renders species + level + HP for each mon", () => {
    // species id 277 = Treecko (Hoenn starter).
    const out = formatGameStateForPrompt(
      snapshot({
        party: [
          {
            personality: 0,
            otId: 0,
            species: 277,
            level: 12,
            hp: 29,
            maxHp: 31,
            isEgg: false,
            nickname: "TREECKO",
          },
        ],
      }),
    );
    expect(out).toContain("Party: Treecko L12 (HP 29/31)");
  });

  test("party omits eggs (they're not actionable mons)", () => {
    const out = formatGameStateForPrompt(
      snapshot({
        party: [
          {
            personality: 0,
            otId: 0,
            species: 0,
            level: 5,
            hp: 0,
            maxHp: 0,
            isEgg: true,
            nickname: "EGG",
          },
        ],
      }),
    );
    expect(out).toContain("Party: empty");
  });

  test("custom nicknames surface in quotes alongside species", () => {
    const out = formatGameStateForPrompt(
      snapshot({
        party: [
          {
            personality: 0,
            otId: 0,
            species: 277,
            level: 8,
            hp: 22,
            maxHp: 22,
            isEgg: false,
            nickname: "Stabby",
          },
        ],
      }),
    );
    expect(out).toContain(`Treecko "Stabby" L8`);
  });

  test("badges line names earned gym badges by short name", () => {
    const badges = Array.from({ length: 8 }, () => false);
    badges[0] = true; // Stone
    badges[2] = true; // Dynamo
    const out = formatGameStateForPrompt(snapshot({ badges }));
    expect(out).toContain("Badges (2/8): Stone, Dynamo");
  });

  test("dex count is the popcount of the bitfield", () => {
    const dexOwned = new Uint8Array(52);
    dexOwned[0] = 0b1111_1111; // 8 owned
    dexOwned[1] = 0b0000_1111; // 4 owned
    dexOwned[5] = 0b0000_0001; // 1 owned, total 13
    const out = formatGameStateForPrompt(snapshot({ dexOwned }));
    expect(out).toContain("Pokédex owned: 13");
  });

  test("last-catch line shows species + shiny status when present", () => {
    // Internal id 277 = TREECKO (same id used in the party test above).
    const out = formatGameStateForPrompt(
      snapshot({ caughtMonSpecies: 277, caughtMonShiny: true }),
    );
    expect(out).toContain("Last caught: Treecko (shiny: yes)");
  });

  test("last-catch line shows shiny: no for non-shiny encounters", () => {
    const out = formatGameStateForPrompt(
      snapshot({ caughtMonSpecies: 277, caughtMonShiny: false }),
    );
    expect(out).toContain("Last caught: Treecko (shiny: no)");
  });

  test("omits spatial lines when no spatial snapshot is provided", () => {
    const out = formatGameStateForPrompt(snapshot());
    expect(out).not.toContain("Location:");
    expect(out).not.toContain("Standing on:");
    expect(out).not.toContain("Nearby objects");
  });

  test("location line names the map via mapGroup/mapNum and shows facing", () => {
    // mapGroup=1 mapNum=4 = LittlerootTown_ProfessorBirchsLab in
    // gMapGroup_IndoorLittleroot (group 1, index 4 — see generated table).
    const out = formatGameStateForPrompt(
      snapshot(),
      spatial({ x: 12, y: 7, facing: "north", mapGroup: 1, mapNum: 4 }),
    );
    expect(out).toContain(
      "Location: Littleroot Town: Professor Birch's Lab @ (12, 7) facing north, on foot",
    );
  });

  test("standing-on line surfaces non-normal tile behavior", () => {
    const out = formatGameStateForPrompt(
      snapshot(),
      spatial({
        onTileBehavior:
          "warp arrow south — press south here to use this stair/door",
      }),
    );
    expect(out).toContain(
      "Standing on: warp arrow south — press south here to use this stair/door",
    );
  });

  test("nearby block shows 'none' when no nearby objects within radius", () => {
    const out = formatGameStateForPrompt(snapshot(), spatial({ nearby: [] }));
    expect(out).toContain("Nearby objects: none within 5 tiles");
  });

  test("nearby block lists actionable objects sorted by distance with direction", () => {
    const out = formatGameStateForPrompt(
      snapshot(),
      spatial({
        nearby: [
          // ITEM_BALL three tiles south (the user-visible "Poké Ball on the ground").
          {
            dx: 0,
            dy: 3,
            manhattan: 3,
            facing: "unknown",
            kind: "item",
            graphicsId: 59,
          },
          // A regular NPC one tile east, facing west (back toward the player).
          {
            dx: 1,
            dy: 0,
            manhattan: 1,
            facing: "west",
            kind: "npc",
            graphicsId: 19,
          },
        ],
      }),
    );
    expect(out).toContain("Nearby objects (sorted by distance");
    expect(out).toContain("NPC (gfx 19) 1 tile east (dx=1, dy=0), facing west");
    expect(out).toContain(
      "ITEM (Poké Ball on the ground) 3 tiles south (dx=0, dy=3)",
    );
  });

  test("nearby block classifies cuttable trees and breakable rocks distinctly", () => {
    const out = formatGameStateForPrompt(
      snapshot(),
      spatial({
        nearby: [
          {
            dx: -2,
            dy: 0,
            manhattan: 2,
            facing: "unknown",
            kind: "tree",
            graphicsId: 82,
          },
          {
            dx: 0,
            dy: -1,
            manhattan: 1,
            facing: "unknown",
            kind: "rock",
            graphicsId: 86,
          },
        ],
      }),
    );
    expect(out).toContain("CUTTABLE TREE (needs HM Cut) 2 tiles west");
    expect(out).toContain("BREAKABLE ROCK (needs HM Rock Smash) 1 tile north");
  });
});
