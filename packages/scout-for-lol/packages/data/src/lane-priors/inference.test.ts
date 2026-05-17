import { describe, expect, test } from "bun:test";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import {
  inferStandardLanes,
  normalizeSpellPair,
} from "#src/lane-priors/inference.ts";
import {
  LanePriorArtifactSchema,
  SpellPairKeySchema,
} from "#src/lane-priors/schema.ts";

describe("normalizeSpellPair", () => {
  test("normalizes spell order", () => {
    expect(normalizeSpellPair(4, 11)).toBe(normalizeSpellPair(11, 4));
    expect(normalizeSpellPair(11, 4)).toBe(SpellPairKeySchema.parse("4:11"));
  });
});

describe("lane prior artifact validation", () => {
  test("accepts the generated artifact", () => {
    expect(
      LanePriorArtifactSchema.parse(currentLanePriors).artifactVersion,
    ).toBe(1);
  });

  test("rejects malformed generated data", () => {
    expect(() =>
      LanePriorArtifactSchema.parse({
        ...currentLanePriors,
        champions: [
          {
            championId: 150,
            total: 0,
            counts: currentLanePriors.champions[0]?.counts,
            probabilities: currentLanePriors.champions[0]?.probabilities,
          },
        ],
      }),
    ).toThrow();
  });
});

describe("inferStandardLanes", () => {
  test("resolves known S3-derived composition", () => {
    const result = inferStandardLanes(
      [
        { participantKey: "ezreal", championId: 81, spell1Id: 21, spell2Id: 4 },
        { participantKey: "sona", championId: 37, spell1Id: 7, spell2Id: 4 },
        {
          participantKey: "viktor",
          championId: 112,
          spell1Id: 12,
          spell2Id: 4,
        },
        { participantKey: "gnar", championId: 150, spell1Id: 4, spell2Id: 12 },
        {
          participantKey: "graves",
          championId: 104,
          spell1Id: 4,
          spell2Id: 11,
        },
      ],
      currentLanePriors,
    );

    expect(result.assignments).toContainEqual({
      participantKey: "gnar",
      lane: "top",
      score: expect.any(Number),
    });
    expect(result.assignments).toContainEqual({
      participantKey: "graves",
      lane: "jungle",
      score: expect.any(Number),
    });
    expect(result.assignments).toContainEqual({
      participantKey: "viktor",
      lane: "middle",
      score: expect.any(Number),
    });
    expect(result.assignments).toContainEqual({
      participantKey: "ezreal",
      lane: "adc",
      score: expect.any(Number),
    });
    expect(result.assignments).toContainEqual({
      participantKey: "sona",
      lane: "support",
      score: expect.any(Number),
    });
  });

  test("uses Smite as a strong jungle signal", () => {
    const result = inferStandardLanes(
      [
        { participantKey: "a", championId: 99_901, spell1Id: 4, spell2Id: 14 },
        { participantKey: "b", championId: 99_902, spell1Id: 4, spell2Id: 11 },
        { participantKey: "c", championId: 99_903, spell1Id: 4, spell2Id: 12 },
        { participantKey: "d", championId: 99_904, spell1Id: 4, spell2Id: 21 },
        { participantKey: "e", championId: 99_905, spell1Id: 4, spell2Id: 7 },
      ],
      currentLanePriors,
    );
    expect(
      result.assignments.find((assignment) => assignment.lane === "jungle"),
    ).toMatchObject({ participantKey: "b" });
  });

  test("chooses deterministic complete assignment for ambiguous teams", () => {
    const result = inferStandardLanes(
      [
        { participantKey: "a", championId: 99_901, spell1Id: 1, spell2Id: 2 },
        { participantKey: "b", championId: 99_902, spell1Id: 1, spell2Id: 2 },
        { participantKey: "c", championId: 99_903, spell1Id: 1, spell2Id: 2 },
        { participantKey: "d", championId: 99_904, spell1Id: 1, spell2Id: 2 },
        { participantKey: "e", championId: 99_905, spell1Id: 1, spell2Id: 2 },
      ],
      currentLanePriors,
    );

    expect(result.assignments.map((assignment) => assignment.lane)).toEqual([
      "top",
      "jungle",
      "middle",
      "adc",
      "support",
    ]);
  });
});
