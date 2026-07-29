import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { archipelagoRandomizerMetadataLines } from "./archipelago.ts";
import {
  BULBAPEDIA_REQUEST_DELAY_MS,
  buildBulbapediaRequestUrl,
  parsePinnedBulbapediaPage,
} from "./bulbapedia.ts";
import { KNOWLEDGE_FETCH_TIMEOUT_MS } from "./fetch.ts";
import {
  CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS,
  generation3DamageClass,
  generation3PowerLabel,
  includeGeneration3Item,
} from "./pokeapi.ts";
import {
  generation3FriendshipCondition,
  requirePokeApiReference,
} from "./pokeapi-relations.ts";

const BULBAPEDIA_PIN = {
  title: "Walkthrough:Pokémon Emerald",
  revision: 4_512_784,
  timestamp: "2026-03-19T15:26:23Z",
};

const SourceJsonSchema = z.object({
  required: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
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

describe("Generation III move normalization", () => {
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
  test("requests the exact revision instead of the current page title", () => {
    const url = new URL(
      buildBulbapediaRequestUrl(
        "https://bulbapedia.bulbagarden.net/w/api.php",
        BULBAPEDIA_PIN,
      ),
    );

    expect(url.searchParams.get("revids")).toBe("4512784");
    expect(url.searchParams.has("titles")).toBe(false);
    expect(url.searchParams.get("prop")).toBe("extracts|revisions");
    expect(url.searchParams.get("rvprop")).toBe("ids|timestamp");
  });

  test("accepts only response metadata matching the pinned revision", () => {
    const page = {
      pageid: 76_032,
      title: BULBAPEDIA_PIN.title,
      extract: "Pinned walkthrough text.",
      revisions: [
        {
          revid: BULBAPEDIA_PIN.revision,
          timestamp: BULBAPEDIA_PIN.timestamp,
        },
      ],
    };
    expect(
      parsePinnedBulbapediaPage({ query: { pages: [page] } }, BULBAPEDIA_PIN),
    ).toEqual(page);
    expect(() =>
      parsePinnedBulbapediaPage(
        {
          query: {
            pages: [
              {
                ...page,
                revisions: [
                  {
                    revid: BULBAPEDIA_PIN.revision + 1,
                    timestamp: BULBAPEDIA_PIN.timestamp,
                  },
                ],
              },
            ],
          },
        },
        BULBAPEDIA_PIN,
      ),
    ).toThrow("returned unexpected revision data");
  });

  test("uses bounded requests and the documented polite delay", () => {
    expect(KNOWLEDGE_FETCH_TIMEOUT_MS).toBe(30_000);
    expect(BULBAPEDIA_REQUEST_DELAY_MS).toBe(5000);
  });
});
