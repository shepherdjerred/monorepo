import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import rawSchema from "./coach-context.schema.json" with { type: "json" };
import rawFixtures from "./coach-context.fixtures.json" with { type: "json" };
import {
  COACH_CONTEXT_SECTIONS,
  COACH_GAME_CONTEXT_MAX_BYTES,
  CoachGameContextSchema,
} from "./coach-context.schema.ts";

const JsonObjectSchema = z.record(z.string(), z.unknown());
const DefsSchema = z.record(z.string(), JsonObjectSchema);
const REF_PREFIX = "#/$defs/";
/** Prose and identity: they describe the contract, they do not shape it. */
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);

/** The JSON Schema with every `$ref` inlined and annotations dropped. */
function inlined(node: unknown, defs: z.infer<typeof DefsSchema>): unknown {
  const array = z.array(z.unknown()).safeParse(node);
  if (array.success) return array.data.map((entry) => inlined(entry, defs));
  const object = JsonObjectSchema.safeParse(node);
  if (!object.success) return node;
  const ref = z.string().safeParse(object.data["$ref"]);
  if (ref.success) {
    const target = defs[ref.data.slice(REF_PREFIX.length)];
    if (target === undefined) throw new Error(`unresolved ${ref.data}`);
    return inlined(target, defs);
  }
  return Object.fromEntries(
    Object.entries(object.data)
      .filter(([key]) => !ANNOTATIONS.has(key) && key !== "$defs")
      .map(([key, value]) => [key, inlined(value, defs)]),
  );
}

/** Every dotted property path an object schema declares. */
function declaredPaths(node: unknown, prefix = ""): string[] {
  const object = JsonObjectSchema.safeParse(node);
  if (!object.success) return [];
  const properties = JsonObjectSchema.safeParse(object.data["properties"]);
  const own = properties.success
    ? Object.entries(properties.data).flatMap(([key, value]) => [
        `${prefix}${key}`,
        ...declaredPaths(value, `${prefix}${key}.`),
      ])
    : [];
  const nested = ["items", "anyOf"].flatMap((key) => {
    const child = object.data[key];
    const children = z.array(z.unknown()).safeParse(child);
    return (children.success ? children.data : [child]).flatMap((entry) =>
      declaredPaths(entry, prefix),
    );
  });
  return [...own, ...nested];
}

/** Every dotted key path a JSON value uses. */
function usedPaths(value: unknown, prefix = ""): string[] {
  const array = z.array(z.unknown()).safeParse(value);
  if (array.success) {
    return array.data.flatMap((entry) => usedPaths(entry, prefix));
  }
  const object = JsonObjectSchema.safeParse(value);
  if (!object.success) return [];
  return Object.entries(object.data).flatMap(([key, child]) => [
    `${prefix}${key}`,
    ...usedPaths(child, `${prefix}${key}.`),
  ]);
}

/** A string of three-byte characters. */
function text(length: number): string {
  return "€".repeat(length);
}

/** The largest context the bounds admit: full lists, three-byte characters. */
function largestContext(): unknown {
  const u32 = 4_294_967_295;
  const stat = -1.2345678901234567e300;
  const name = text(64);
  const spells = [name, name];
  const item = { itemId: u32, name: text(96), count: 255 };
  const stats = Object.fromEntries(
    [
      "maxHealth",
      "health",
      "maxResource",
      "currentResource",
      "armor",
      "magicResist",
      "attackDamage",
      "abilityPower",
      "attackSpeed",
      "moveSpeed",
      "critChance",
    ].map((key) => [key, stat]),
  );
  return {
    champSelect: {
      phase: text(32),
      localCellId: 255,
      myTeam: Array.from({ length: 5 }, () => ({
        cellId: 255,
        championId: u32,
        assignedRole: text(16),
      })),
      theirTeam: Array.from({ length: 5 }, () => ({
        cellId: 255,
        championId: u32,
      })),
      myBans: Array.from({ length: 5 }, () => u32),
      theirBans: Array.from({ length: 5 }, () => u32),
    },
    pregame: {
      game: { mode: name, map: name },
      participants: Array.from({ length: 16 }, () => ({
        team: "order",
        isSelf: false,
        champion: name,
        summonerSpells: spells,
        keystone: name,
      })),
    },
    live: {
      game: { mode: name, map: name, gameTimeSecs: u32 },
      own: { ...stats, gold: u32, resource: name },
      participants: Array.from({ length: 16 }, () => ({
        team: "order",
        isSelf: false,
        champion: name,
        level: 255,
        kills: u32,
        deaths: u32,
        assists: u32,
        creepScore: u32,
        items: Array.from({ length: 7 }, () => item),
        summonerSpells: spells,
        keystone: name,
      })),
      eventCount: u32,
      latestEvent: { id: u32, kind: name, timeSecs: -stat },
    },
    postgame: { matchId: `ABCDEF_${"9".repeat(20)}` },
  };
}

const schema = inlined(rawSchema, DefsSchema.parse(rawSchema.$defs));
const validateWithJsonSchema = new Ajv2020({ strict: true }).compile(rawSchema);

describe("Scout coach game context contract", () => {
  test("the Zod schema is the JSON Schema", () => {
    const fromZod = inlined(
      z.toJSONSchema(CoachGameContextSchema, {
        target: "draft-2020-12",
        reused: "inline",
      }),
      {},
    );
    // `minProperties` is the one rule Zod states as a refinement, which a
    // JSON Schema export cannot carry; the `{}` reject fixture covers it.
    const { minProperties, ...rest } = JsonObjectSchema.parse(schema);
    expect(minProperties).toBe(1);
    expect(fromZod).toEqual(rest);
  });

  test("the sections are the schema's top-level properties", () => {
    expect(Object.keys(rawSchema.properties)).toEqual([
      ...COACH_CONTEXT_SECTIONS,
    ]);
  });

  test("the complete fixture uses every field the schema declares", () => {
    const complete = rawFixtures.valid[0]?.body;
    expect(new Set(usedPaths(complete))).toEqual(
      new Set(declaredPaths(schema)),
    );
  });

  test("the largest context the bounds admit fits the byte limit", () => {
    const largest = largestContext();
    expect(CoachGameContextSchema.safeParse(largest).success).toBe(true);
    expect(validateWithJsonSchema(largest)).toBe(true);
    const bytes = new TextEncoder().encode(JSON.stringify(largest)).length;
    expect(bytes).toBeLessThanOrEqual(COACH_GAME_CONTEXT_MAX_BYTES);
    expect(bytes).toBeGreaterThan(COACH_GAME_CONTEXT_MAX_BYTES * 0.9);
  });

  test.each(rawFixtures.valid)("accepts $name", ({ body }) => {
    expect(validateWithJsonSchema(body)).toBe(true);
    expect(CoachGameContextSchema.parse(body)).toEqual(body);
  });

  test.each(rawFixtures.invalid)("rejects $reason", ({ body }) => {
    expect(validateWithJsonSchema(body)).toBe(false);
    expect(CoachGameContextSchema.safeParse(body).success).toBe(false);
  });
});
