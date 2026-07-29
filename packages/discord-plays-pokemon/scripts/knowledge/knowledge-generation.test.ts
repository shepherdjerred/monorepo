import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { archipelagoRandomizerMetadataLines } from "./archipelago.ts";
import {
  BULBAPEDIA_REQUEST_DELAY_MS,
  buildBulbapediaRequestUrl,
  extractBulbapediaPlainText,
  parsePinnedBulbapediaPage,
} from "./bulbapedia.ts";
import { KNOWLEDGE_FETCH_TIMEOUT_MS } from "./fetch.ts";
import {
  CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS,
  generation3DamageClass,
  generation3PowerLabel,
  includeGeneration3Item,
  moveForVersion,
} from "./pokeapi.ts";
import {
  emeraldShedinjaEvolutionCondition,
  emeraldWurmpleEvolutionCondition,
  generation3FriendshipCondition,
  requirePokeApiReference,
} from "./pokeapi-relations.ts";
import {
  validateShedinjaSource,
  validateWurmpleSource,
} from "./pokeemerald.ts";

const BULBAPEDIA_PIN = {
  title: "Walkthrough:Pokémon Emerald",
  revision: 4_512_784,
  timestamp: "2026-03-19T15:26:23Z",
};

const SourceJsonSchema = z.object({
  required: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
});
const KnowledgeJsonSchema = z.object({
  items: z.object({
    required: z.array(z.string()),
    properties: z.object({
      sources: z.object({
        minItems: z.number().int().positive(),
      }),
    }),
  }),
});

test("source JSON Schema accepts its own $schema property", async () => {
  const schema = SourceJsonSchema.parse(
    await Bun.file(
      new URL("../../knowledge/sources.schema.json", import.meta.url),
    ).json(),
  );
  expect(schema.required).toContain("$schema");
  expect(schema.properties["$schema"]).toBeDefined();
});

test("record JSON Schema requires non-empty structured provenance", async () => {
  const schema = KnowledgeJsonSchema.parse(
    await Bun.file(
      new URL("../../knowledge/schema.json", import.meta.url),
    ).json(),
  );
  expect(schema.items.required).toContain("sources");
  expect(schema.items.required).not.toContain("source");
  expect(schema.items.properties.sources.minItems).toBe(1);
});

describe("Generation III move normalization", () => {
  test("reconstructs each historical field from its first applicable change", () => {
    const move = {
      id: 22,
      identifier: "vine-whip",
      generation_id: 1,
      type_id: 12,
      power: 45,
      pp: 25,
      accuracy: 100,
      priority: 0,
      damage_class_id: 2,
    };
    const historical = moveForVersion(
      move,
      [
        {
          move_id: move.id,
          changed_in_version_group_id: 8,
          type_id: undefined,
          power: undefined,
          pp: 10,
          accuracy: undefined,
          priority: undefined,
        },
        {
          move_id: move.id,
          changed_in_version_group_id: 11,
          type_id: undefined,
          power: 35,
          pp: undefined,
          accuracy: 95,
          priority: undefined,
        },
      ],
      6,
    );
    expect(historical).toEqual({
      type_id: 12,
      power: 35,
      pp: 10,
      accuracy: 95,
      priority: 0,
    });
  });

  test("treats fixed and variable damage attacks as damaging moves", () => {
    expect(generation3DamageClass("dragon", 3)).toBe("special");
    expect(generation3DamageClass("ground", 2)).toBe("physical");
    expect(generation3DamageClass("ghost", 2)).toBe("physical");
    expect(generation3DamageClass("fighting", 2)).toBe("physical");
    expect(generation3PowerLabel(undefined, "special")).toBe(
      "fixed or variable",
    );
    expect(generation3PowerLabel(undefined, "physical")).toBe(
      "fixed or variable",
    );
  });

  test("retains status classification for actual status moves", () => {
    expect(generation3DamageClass("normal", 1)).toBe("status");
    expect(generation3PowerLabel(undefined, "status")).toBe("status");
  });

  test("rejects unknown PokeAPI damage classes", () => {
    expect(() => generation3DamageClass("normal", 4)).toThrow(
      "unknown PokeAPI move damage class id 4",
    );
  });
});

describe("Generation III item normalization", () => {
  test("excludes the confirmed FireRed and LeafGreen-only identifiers", () => {
    expect(CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS).toEqual([
      "tea",
      "tri-pass",
      "rainbow-pass",
      "ruby",
      "sapphire",
    ]);
    for (const identifier of CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS) {
      expect(includeGeneration3Item(identifier)).toBe(false);
    }
    expect(includeGeneration3Item("poke-ball")).toBe(true);
  });
});

describe("PokeAPI relational integrity", () => {
  test("requires every referenced CSV row to resolve", () => {
    const types = new Map([[3, "flying"]]);
    expect(requirePokeApiReference(types, 3, "types", "move gust")).toBe(
      "flying",
    );
    expect(() =>
      requirePokeApiReference(types, 99, "types", "move glitch"),
    ).toThrow("PokeAPI move glitch references missing types row 99");
  });
});

describe("Generation III evolution normalization", () => {
  test("omits PokeAPI's unversioned numeric friendship threshold", () => {
    expect(generation3FriendshipCondition(160)).toBe("high friendship");
    expect(generation3FriendshipCondition(220)).toBe("high friendship");
    expect(generation3FriendshipCondition(undefined)).toBeUndefined();
  });

  test("requires pinned Emerald evidence for Shedinja creation", () => {
    const table = `
      [SPECIES_NINCADA] = {
        {EVO_LEVEL_NINJASK, 20, SPECIES_NINJASK},
        {EVO_LEVEL_SHEDINJA, 20, SPECIES_SHEDINJA}
      }
    `;
    const scene = `
      if (gEvolutionTable[preEvoSpecies][0].method == EVO_LEVEL_NINJASK
          && gPlayerPartyCount < PARTY_SIZE)
    `;
    expect(validateShedinjaSource(table, scene)).toBeUndefined();
    expect(() => validateShedinjaSource(table, "no party condition")).toThrow(
      "empty-party-slot Shedinja condition",
    );
    expect(() =>
      validateShedinjaSource(
        table,
        `${scene} CheckBagHasItem(ITEM_POKE_BALL, 1);`,
      ),
    ).toThrow("now checks for a Poké Ball");
  });

  test("expands PokeAPI's generic shed trigger with pinned Emerald facts", () => {
    expect(emeraldShedinjaEvolutionCondition("shed", "shedinja")).toContain(
      "Nincada evolves at level 20, Shedinja is created alongside Ninjask only with an empty party slot",
    );
    expect(
      emeraldShedinjaEvolutionCondition("level-up", "ninjask"),
    ).toBeUndefined();
    expect(() =>
      emeraldShedinjaEvolutionCondition("shed", "missingno"),
    ).toThrow("shed evolution unexpectedly targets missingno");
  });

  test("requires pinned Emerald evidence for Wurmple's evolution branch", () => {
    const table = `
      [SPECIES_WURMPLE] = {
        {EVO_LEVEL_SILCOON, 7, SPECIES_SILCOON},
        {EVO_LEVEL_CASCOON, 7, SPECIES_CASCOON}
      }
    `;
    const pokemonSource = `
      u16 upperPersonality = personality >> 16;
      case EVO_LEVEL_SILCOON:
        if (gEvolutionTable[species][i].param <= level && (upperPersonality % 10) <= 4)
          targetSpecies = gEvolutionTable[species][i].targetSpecies;
        break;
      case EVO_LEVEL_CASCOON:
        if (gEvolutionTable[species][i].param <= level && (upperPersonality % 10) > 4)
          targetSpecies = gEvolutionTable[species][i].targetSpecies;
        break;
    `;
    expect(validateWurmpleSource(table, pokemonSource)).toBeUndefined();
    expect(() => validateWurmpleSource(table, "no personality branch")).toThrow(
      "hidden-personality Wurmple branch",
    );
  });

  test("expands Wurmple's generic branches with pinned Emerald facts", () => {
    expect(
      emeraldWurmpleEvolutionCondition("level-up", "silcoon", 7),
    ).toContain("hidden upper personality value modulo 10 (0-4");
    expect(
      emeraldWurmpleEvolutionCondition("level-up", "cascoon", 7),
    ).toContain("hidden upper personality value modulo 10 (5-9");
    expect(
      emeraldWurmpleEvolutionCondition("level-up", "beautifly", 10),
    ).toBeUndefined();
    expect(() =>
      emeraldWurmpleEvolutionCondition("level-up", "silcoon", 8),
    ).toThrow("expected level-7 level-up condition");
  });
});

describe("Archipelago world metadata", () => {
  test("labels randomizer metadata without claiming vanilla rewards", () => {
    expect(
      archipelagoRandomizerMetadataLines(
        ["TRAINER_CALVIN_1_REWARD"],
        ["FREE_FLY_LOCATION"],
      ),
    ).toEqual([
      "Archipelago randomizer check identifiers (not vanilla rewards): TRAINER_CALVIN_1_REWARD",
      "Archipelago randomizer logic identifiers (not vanilla events): FREE_FLY_LOCATION",
    ]);
  });
});

describe("pinned Bulbapedia requests", () => {
  test("requests rendered content for the exact oldid", () => {
    const url = new URL(
      buildBulbapediaRequestUrl(
        "https://bulbapedia.bulbagarden.net/w/api.php",
        BULBAPEDIA_PIN,
      ),
    );

    expect(url.searchParams.get("action")).toBe("parse");
    expect(url.searchParams.get("oldid")).toBe("4512784");
    expect(url.searchParams.has("titles")).toBe(false);
    expect(url.searchParams.has("revids")).toBe(false);
    expect(url.searchParams.get("prop")).toBe("text|revid");
    expect(url.searchParams.get("disablelimitreport")).toBe("1");
    expect(url.searchParams.get("disableeditsection")).toBe("1");
    expect(url.searchParams.get("disabletoc")).toBe("1");
  });

  test("couples rendered text to the matching revision payload", () => {
    const page = {
      pageid: 76_032,
      title: BULBAPEDIA_PIN.title,
      revid: BULBAPEDIA_PIN.revision,
      text: '<div class="mw-parser-output"><p>Pinned text.</p></div>',
    };
    expect(parsePinnedBulbapediaPage({ parse: page }, BULBAPEDIA_PIN)).toEqual(
      page,
    );
    expect(() =>
      parsePinnedBulbapediaPage(
        {
          parse: {
            ...page,
            revid: BULBAPEDIA_PIN.revision + 1,
            text: "Text from a later revision.",
          },
        },
        BULBAPEDIA_PIN,
      ),
    ).toThrow("returned unexpected parsed revision");
    expect(() =>
      parsePinnedBulbapediaPage(
        {
          parse: {
            ...page,
            title: "Walkthrough:Pokémon Emerald/Current",
          },
        },
        BULBAPEDIA_PIN,
      ),
    ).toThrow("returned unexpected parsed revision");
  });

  test("extracts deterministic plain text from pinned rendered HTML", async () => {
    const html = `
      <div class="mw-parser-output">
        <table><tr><td>Navigation from latest state</td></tr></table>
        <h2>Start &amp; setup</h2>
        <p>Pinned&#160;walkthrough<br>Second line.</p>
        <ul><li>First step</li><li>Second step</li></ul>
        <div class="partycontainer">Rendered battle card</div>
        <sup class="reference">[1]</sup>
      </div>
    `;
    expect(await extractBulbapediaPlainText(html)).toBe(
      "Start & setup\n\nPinned walkthrough\nSecond line.\n\nFirst step\nSecond step",
    );
    await expect(
      extractBulbapediaPlainText(
        '<div class="mw-parser-output"><p>Unsupported &copy;</p></div>',
      ),
    ).rejects.toThrow("unsupported HTML entity &copy;");
    await expect(
      extractBulbapediaPlainText("<p>Missing article container</p>"),
    ).rejects.toThrow("omitted .mw-parser-output");
  });

  test("uses bounded requests and the documented polite delay", () => {
    expect(KNOWLEDGE_FETCH_TIMEOUT_MS).toBe(30_000);
    expect(BULBAPEDIA_REQUEST_DELAY_MS).toBe(5000);
  });
});
