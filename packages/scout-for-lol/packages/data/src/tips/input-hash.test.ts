import { beforeAll, describe, expect, test } from "vitest";
import {
  type ChampionGrounding,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import {
  computeTipInputHash,
  isTipSetStale,
  isTipSetStaleAgainstCurrentFacts,
  stableStringify,
  type TipUnit,
} from "#src/tips/input-hash.ts";
import {
  AHRI,
  FIXTURE_PROMPT_VERSION,
  SYNDRA,
  ahriMidGeneralSet,
  ahriSyndraMidSets,
} from "#src/tips/tips.fixture.ts";

let ahri: ChampionGrounding;
let syndra: ChampionGrounding;

beforeAll(async () => {
  [ahri, syndra] = await Promise.all([
    loadChampionGrounding(AHRI),
    loadChampionGrounding(SYNDRA),
  ]);
});

function withCharmCooldown(
  grounding: ChampionGrounding,
  cooldown: number,
): ChampionGrounding {
  const charm = grounding.facts.abilities.E;
  return {
    ...grounding,
    facts: {
      ...grounding.facts,
      abilities: {
        ...grounding.facts.abilities,
        E: {
          ...charm,
          cooldownByRank: charm.cooldownByRank.map(() => cooldown),
        },
      },
    },
  };
}

describe("stableStringify", () => {
  test("ignores object key order", () => {
    expect(stableStringify({ b: [1, { d: 2, c: 3 }], a: null })).toBe(
      stableStringify({ a: null, b: [1, { c: 3, d: 2 }] }),
    );
  });
});

describe("tip input hash", () => {
  test("is a SHA-256 hex digest that is the same for both directions of a pair", () => {
    const forward = computeTipInputHash(
      FIXTURE_PROMPT_VERSION,
      { kind: "matchup", lane: "middle", championIds: [AHRI, SYNDRA] },
      [ahri, syndra],
    );
    const reverse = computeTipInputHash(
      FIXTURE_PROMPT_VERSION,
      { kind: "matchup", lane: "middle", championIds: [SYNDRA, AHRI] },
      [syndra, ahri],
    );
    expect(forward).toMatch(/^[0-9a-f]{64}$/);
    expect(reverse).toBe(forward);
  });

  test("changes with the prompt version, the lane and the facts", () => {
    const unit: TipUnit = {
      kind: "general",
      lane: "middle",
      championIds: [AHRI],
    };
    const base = computeTipInputHash("v1", unit, [ahri]);
    expect(computeTipInputHash("v2", unit, [ahri])).not.toBe(base);
    expect(
      computeTipInputHash("v1", { ...unit, lane: "top" }, [ahri]),
    ).not.toBe(base);
    expect(
      computeTipInputHash("v1", unit, [withCharmCooldown(ahri, 30)]),
    ).not.toBe(base);
  });

  test("throws when a unit's champion has no grounding", () => {
    expect(() =>
      computeTipInputHash(
        "v1",
        { kind: "matchup", lane: "middle", championIds: [AHRI, SYNDRA] },
        [ahri],
      ),
    ).toThrow(/no grounding supplied/);
  });
});

describe("stale detection", () => {
  test("a set is fresh against the facts it was hashed from and stale once they change", async () => {
    const hash = computeTipInputHash(
      FIXTURE_PROMPT_VERSION,
      { kind: "matchup", lane: "middle", championIds: [AHRI, SYNDRA] },
      [ahri, syndra],
    );
    const { forward, reverse } = ahriSyndraMidSets(hash);
    expect(isTipSetStale(forward, [ahri, syndra])).toBe(false);
    expect(isTipSetStale(reverse, [ahri, syndra])).toBe(false);
    expect(await isTipSetStaleAgainstCurrentFacts(forward)).toBe(false);
    expect(isTipSetStale(forward, [withCharmCooldown(ahri, 30), syndra])).toBe(
      true,
    );
  });

  test("a general set with a hash from other facts is stale", async () => {
    expect(
      await isTipSetStaleAgainstCurrentFacts(ahriMidGeneralSet("0".repeat(64))),
    ).toBe(true);
  });
});
