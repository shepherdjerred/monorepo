import { describe, expect, test } from "bun:test";
import {
  buildCatalog,
  normalizeCatalogName,
  parseContiguousIds,
  parseItemBattleUses,
  parseItemNames,
  parseMoveNames,
  parseMoveTargets,
  renderCatalogModule,
  renderItemBattleUses,
  renderMoveTargets,
} from "./generate-battle-data.ts";

describe("battle data generation", () => {
  test("parses a contiguous ID catalog before its count sentinel", () => {
    const ids = parseContiguousIds(
      [
        "#define MOVE_NONE 0",
        "#define MOVE_POUND 1",
        "#define MOVES_COUNT 2",
        "#define MOVE_UNAVAILABLE 65535",
      ].join("\n"),
      "MOVE_",
      "MOVES_COUNT",
    );

    expect([...ids]).toEqual([
      ["MOVE_NONE", 0],
      ["MOVE_POUND", 1],
    ]);
  });

  test("rejects missing and colliding IDs", () => {
    expect(() =>
      parseContiguousIds(
        [
          "#define MOVE_NONE 0",
          "#define MOVE_POUND 2",
          "#define MOVES_COUNT 3",
        ].join("\n"),
        "MOVE_",
        "MOVES_COUNT",
      ),
    ).toThrow("MOVE_ catalog is missing ID 1");

    expect(() =>
      parseContiguousIds(
        [
          "#define ITEM_NONE 0",
          "#define ITEM_POTION 0",
          "#define ITEMS_COUNT 2",
        ].join("\n"),
        "ITEM_",
        "ITEMS_COUNT",
      ),
    ).toThrow("ID 0 is assigned to both ITEM_NONE and ITEM_POTION");
  });

  test("treats catalog selectors as literal identifiers", () => {
    expect(() =>
      parseContiguousIds(
        ["#define MOVE_NONE 0", "#define MOVES_COUNT 1"].join("\n"),
        "MOVE_[",
        "MOVES_COUNT",
      ),
    ).toThrow("MOVE_[ catalog is missing ID 0");

    expect(() =>
      parseContiguousIds(
        ["#define MOVE_NONE 0", "#define MOVES_COUNT 1"].join("\n"),
        "MOVE_",
        "MOVES_COUNT[",
      ),
    ).toThrow("MOVES_COUNT[ not found");
  });

  test("parses move and item display names", () => {
    expect([
      ...parseMoveNames('[MOVE_SAND_ATTACK] = _("SAND-ATTACK"),'),
    ]).toEqual([["MOVE_SAND_ATTACK", "SAND-ATTACK"]]);
    expect([
      ...parseItemNames(
        `
            [ITEM_POKE_BALL] =
            {
                .name = _("POKé BALL"),
                .itemId = ITEM_POKE_BALL,
            },`,
        new Map([["ITEM_POKE_BALL", 0]]),
      ),
    ]).toEqual([["ITEM_POKE_BALL", "POKé BALL"]]);
  });

  test("parses move targets into numeric ID order", () => {
    expect(
      parseMoveTargets(
        `
          [MOVE_NONE] =
          {
            .target = MOVE_TARGET_USER,
          },
          [MOVE_POUND] =
          {
            .target = MOVE_TARGET_SELECTED,
          },`,
        new Map([
          ["MOVE_NONE", 0],
          ["MOVE_POUND", 1],
        ]),
      ),
    ).toEqual([16, 0]);
  });

  test("parses supported battle-item interaction shapes", () => {
    expect(
      parseItemBattleUses(
        `
          [ITEM_NONE] =
          {
            .itemId = ITEM_NONE,
          },
          [ITEM_POKE_BALL] =
          {
            .itemId = ITEM_POKE_BALL,
            .battleUseFunc = ItemUseInBattle_PokeBall,
          },
          [ITEM_POTION] =
          {
            .itemId = ITEM_POTION,
            .battleUseFunc = ItemUseInBattle_Medicine,
          },
          [ITEM_ETHER] =
          {
            .itemId = ITEM_ETHER,
            .battleUseFunc = ItemUseInBattle_PPRecovery,
          },
          [ITEM_X_ATTACK] =
          {
            .itemId = ITEM_X_ATTACK,
            .battleUseFunc = ItemUseInBattle_StatIncrease,
          },
          [ITEM_POKE_DOLL] =
          {
            .itemId = ITEM_POKE_DOLL,
            .battleUseFunc = ItemUseInBattle_Escape,
          },
          [ITEM_ENIGMA_BERRY] =
          {
            .itemId = ITEM_ENIGMA_BERRY,
            .battleUseFunc = ItemUseInBattle_EnigmaBerry,
          },`,
        new Map([
          ["ITEM_NONE", 0],
          ["ITEM_POKE_BALL", 1],
          ["ITEM_POTION", 2],
          ["ITEM_ETHER", 3],
          ["ITEM_X_ATTACK", 4],
          ["ITEM_POKE_DOLL", 5],
          ["ITEM_ENIGMA_BERRY", 6],
        ]),
      ),
    ).toEqual([
      "unavailable",
      "poke-ball",
      "party",
      "move",
      "direct",
      "escape",
      "party",
    ]);
  });
});

describe("battle data catalog rendering", () => {
  test("resolves semantic TM designators through their numeric item ID", () => {
    expect([
      ...parseItemNames(
        `
            [ITEM_TM_FOCUS_PUNCH] =
            {
                .name = _("TM01"),
                .itemId = ITEM_TM01,
            },`,
        new Map([["ITEM_TM01", 289]]),
      ),
    ]).toEqual([["ITEM_TM01", "TM01"]]);
  });

  test("keeps a numeric dummy designator instead of its ITEM_NONE payload", () => {
    expect([
      ...parseItemNames(
        `
            [ITEM_034] =
            {
                .name = _("????????"),
                .itemId = ITEM_NONE,
            },`,
        new Map([
          ["ITEM_NONE", 0],
          ["ITEM_034", 52],
        ]),
      ),
    ]).toEqual([["ITEM_034", "????????"]]);
  });

  test("normalizes accents, punctuation, whitespace, and case", () => {
    expect(normalizeCatalogName("  POKé---BALL ")).toBe("poke ball");
    expect(normalizeCatalogName("Sand-Attack")).toBe("sand attack");
  });

  test("builds indexed names and rejects normalized collisions", () => {
    expect(
      buildCatalog(
        new Map([
          ["ITEM_NONE", 0],
          ["ITEM_POKE_BALL", 1],
        ]),
        new Map([
          ["ITEM_NONE", "????????"],
          ["ITEM_POKE_BALL", "POKé BALL"],
        ]),
      ),
    ).toEqual({
      names: ["????????", "POKé BALL"],
      idsByNormalizedName: { "poke ball": 1 },
    });

    expect(() =>
      buildCatalog(
        new Map([
          ["MOVE_FIRST", 0],
          ["MOVE_SECOND", 1],
        ]),
        new Map([
          ["MOVE_FIRST", "DOUBLE-EDGE"],
          ["MOVE_SECOND", "double edge"],
        ]),
      ),
    ).toThrow('normalized name "double edge" maps to IDs 0 and 1');
  });

  test("rejects ID and name drift", () => {
    expect(() =>
      buildCatalog(
        new Map([["MOVE_POUND", 0]]),
        new Map([["MOVE_SCRATCH", "SCRATCH"]]),
      ),
    ).toThrow("catalog name missing for MOVE_POUND");
  });

  test("renders a pinned catalog with name and resolver APIs", () => {
    const output = renderCatalogModule({
      sourceRef: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      generatorPath: "scripts/generate-battle-data.ts",
      countExport: "MOVES_COUNT",
      namesExport: "MOVE_NAMES",
      lookupName: "MOVE_IDS_BY_NORMALIZED_NAME",
      displayNameFunction: "moveName",
      resolverFunction: "resolveMoveId",
      names: ["-", "POUND"],
      idsByNormalizedName: { pound: 1 },
    });

    expect(output).toContain(
      "Source: ottohg/pokeemerald-wasm@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(output).toContain("export const MOVES_COUNT = 2;");
    expect(output).toContain(
      "export function resolveMoveId(name: string): number | undefined",
    );
  });

  test("renders move-target and battle-item lookup APIs", () => {
    expect(renderMoveTargets([16, 0])).toContain(
      "export function moveTarget(id: number): number",
    );
    expect(renderItemBattleUses(["unavailable", "party"])).toContain(
      "export function itemBattleUse(id: number): ItemBattleUse",
    );
  });
});
