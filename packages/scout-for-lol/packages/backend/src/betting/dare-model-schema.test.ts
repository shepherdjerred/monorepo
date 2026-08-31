import { describe, expect, test } from "vitest";
import {
  DARE_DEFAULT_WINDOW_DAYS,
  DARE_MAX_WINDOW_DAYS,
} from "#src/betting/constants.ts";
import { DareConditionsSchema } from "#src/betting/dare-criteria.ts";
import {
  canonicalizeDareTranslation,
  dareTranslationSchemaFor,
  type DareModelTranslation,
} from "#src/betting/dare-model-schema.ts";
import {
  DareShortlistEntrySchema,
  type DareShortlistEntry,
} from "#src/betting/dare-shortlist.ts";
import { testAccountId, testPuuid } from "#src/testing/test-ids.ts";

function shortlistEntry(
  key: string,
  alias: string,
  id: string,
): DareShortlistEntry {
  return DareShortlistEntrySchema.parse({
    key,
    discordId: testAccountId(id),
    playerId: Number(id),
    alias,
    accounts: [
      {
        puuid: testPuuid(`dare-${id}`),
        trackingStartedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  });
}

const SHORTLIST: DareShortlistEntry[] = [
  shortlistEntry("T1", "alpha", "801"),
  shortlistEntry("T2", "beta", "802"),
  shortlistEntry("T3", "gamma", "803"),
];

const schema = dareTranslationSchemaFor(SHORTLIST);

type ModelLeaf = DareModelTranslation["leaves"][number];

function numericLeaf(overrides: Partial<ModelLeaf> = {}): ModelLeaf {
  return {
    clauseIndex: 0,
    requiredGames: 7,
    kind: "participant_numeric",
    numericField: "kills",
    booleanField: null,
    rateField: null,
    operator: "gte",
    threshold: 10,
    thresholdScaled: null,
    expected: null,
    champion: null,
    ...overrides,
  };
}

function booleanLeaf(overrides: Partial<ModelLeaf> = {}): ModelLeaf {
  return {
    clauseIndex: 0,
    requiredGames: 7,
    kind: "participant_boolean",
    numericField: null,
    booleanField: "win",
    rateField: null,
    operator: null,
    threshold: null,
    thresholdScaled: null,
    expected: true,
    champion: null,
    ...overrides,
  };
}

function rateLeaf(overrides: Partial<ModelLeaf> = {}): ModelLeaf {
  return {
    clauseIndex: 0,
    requiredGames: 1,
    kind: "participant_rate",
    numericField: null,
    booleanField: null,
    rateField: "cs_per_minute",
    operator: "gte",
    threshold: null,
    thresholdScaled: 700,
    expected: null,
    champion: null,
    ...overrides,
  };
}

function output(
  overrides: Partial<DareModelTranslation> = {},
): DareModelTranslation {
  return {
    unmappable: false,
    unmappableReason: null,
    targets: ["T1"],
    horizonKind: "window",
    windowDays: null,
    rootCombinator: "all",
    clauseCombinators: ["all"],
    leaves: [booleanLeaf()],
    ...overrides,
  };
}

function messagesOf(candidate: DareModelTranslation): string[] {
  const result = schema.safeParse(candidate);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe("dareTranslationSchemaFor", () => {
  test("accepts a plain single-leaf window dare", () => {
    expect(schema.safeParse(output()).success).toBe(true);
  });

  test("rejects a target outside the shortlist", () => {
    expect(messagesOf(output({ targets: ["T9"] }))).toContain(
      "T9 is not in the supplied target list",
    );
  });

  test("rejects duplicate targets", () => {
    expect(messagesOf(output({ targets: ["T1", "T1"] }))).toContain(
      "Duplicate target T1",
    );
  });

  test("rejects an empty target list when mappable", () => {
    expect(messagesOf(output({ targets: [] }))).toContain(
      "At least one target is required",
    );
  });

  test("rejects a champion no registry entry resolves", () => {
    const candidate = output({
      leaves: [booleanLeaf({ champion: "NotARealChampion" })],
    });
    expect(messagesOf(candidate)).toContain(
      'Unknown champion "NotARealChampion"',
    );
  });

  test("accepts champion aliases the registry can normalize", () => {
    expect(
      schema.safeParse(
        output({ leaves: [booleanLeaf({ champion: "Wukong" })] }),
      ).success,
    ).toBe(true);
  });

  test("rejects eq on a rate leaf", () => {
    const candidate = output({
      horizonKind: "window",
      leaves: [rateLeaf({ operator: "eq" })],
    });
    expect(messagesOf(candidate)).toContain(
      "Rates never use eq — use gte or lte",
    );
  });

  test("rejects a non-null slot the leaf kind does not use", () => {
    const candidate = output({
      leaves: [numericLeaf({ rateField: "kda" })],
    });
    expect(messagesOf(candidate)).toContain(
      "Slots unused by participant_numeric must be null",
    );
  });

  test("rejects a missing required slot", () => {
    const candidate = output({
      leaves: [numericLeaf({ operator: null })],
    });
    expect(messagesOf(candidate)).toContain(
      "participant_numeric needs numericField, operator, and threshold",
    );
  });

  test("rejects a leaf pointing at a clause that does not exist", () => {
    const candidate = output({
      clauseCombinators: ["all"],
      leaves: [booleanLeaf(), numericLeaf({ clauseIndex: 1 })],
    });
    expect(messagesOf(candidate)).toContain(
      "clauseIndex 1 has no clause — clauseCombinators has 1",
    );
  });

  test("rejects non-contiguous clause coverage (an empty clause)", () => {
    const candidate = output({
      clauseCombinators: ["all", "any"],
      leaves: [booleanLeaf(), numericLeaf()],
    });
    expect(messagesOf(candidate)).toContain(
      "Clause 1 has no leaves — clauseIndex values must cover every clause",
    );
  });

  test("rejects a clause holding more than four leaves", () => {
    const candidate = output({
      clauseCombinators: ["any"],
      leaves: [
        booleanLeaf(),
        numericLeaf(),
        numericLeaf({ numericField: "assists" }),
        numericLeaf({ numericField: "deaths", operator: "lte" }),
        rateLeaf({ requiredGames: 7 }),
      ],
    });
    expect(messagesOf(candidate)).toContain(
      "Clause 0 holds 5 leaves — the maximum is 4",
    );
  });

  test("rejects next_game with requiredGames above one", () => {
    const candidate = output({
      horizonKind: "next_game",
      leaves: [booleanLeaf({ requiredGames: 2 })],
    });
    expect(messagesOf(candidate)).toContain(
      "next_game dares are about one game — every requiredGames must be 1",
    );
  });

  test("rejects next_game carrying a window", () => {
    const candidate = output({
      horizonKind: "next_game",
      windowDays: 7,
      leaves: [booleanLeaf({ requiredGames: 1 })],
    });
    expect(messagesOf(candidate)).toContain(
      "next_game dares have no window — windowDays must be null",
    );
  });

  test("accepts a valid next_game dare", () => {
    const candidate = output({
      horizonKind: "next_game",
      leaves: [booleanLeaf({ requiredGames: 1 })],
    });
    expect(schema.safeParse(candidate).success).toBe(true);
  });

  test("the unmappable escape accepts otherwise-empty output", () => {
    const candidate = output({
      unmappable: true,
      unmappableReason: "Cross-game maintain claims are not expressible",
      targets: [],
      clauseCombinators: [],
      leaves: [],
    });
    expect(schema.safeParse(candidate).success).toBe(true);
  });

  test("an unmappable answer must carry its reason", () => {
    const candidate = output({
      unmappable: true,
      unmappableReason: null,
      targets: [],
      clauseCombinators: [],
      leaves: [],
    });
    expect(messagesOf(candidate)).toContain(
      "An unmappable answer must say why",
    );
  });
});

describe("canonicalizeDareTranslation", () => {
  test("rebuilds the canonical tree and resolves targets", () => {
    const modelOutput = schema.parse(
      output({
        targets: ["T2", "T1"],
        rootCombinator: "any",
        clauseCombinators: ["all", "any"],
        windowDays: DARE_MAX_WINDOW_DAYS,
        leaves: [
          booleanLeaf({ clauseIndex: 0, champion: "Wukong" }),
          numericLeaf({ clauseIndex: 1 }),
          rateLeaf({ clauseIndex: 1, requiredGames: 3 }),
        ],
      }),
    );
    const canonical = canonicalizeDareTranslation(modelOutput, SHORTLIST);
    expect(canonical.targets.map((target) => target.alias)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(canonical.horizonKind).toBe("window");
    expect(canonical.windowDays).toBe(DARE_MAX_WINDOW_DAYS);
    expect(canonical.conditions).toEqual(
      DareConditionsSchema.parse(canonical.conditions),
    );
    expect(canonical.conditions.root).toEqual({
      kind: "any",
      clauses: [
        {
          kind: "all",
          children: [
            {
              kind: "condition",
              requiredGames: 7,
              predicate: {
                kind: "participant_boolean",
                field: "win",
                expected: true,
              },
              // Aliases are stored as the normalized Data Dragon key.
              champion: "MonkeyKing",
            },
          ],
        },
        {
          kind: "any",
          children: [
            {
              kind: "condition",
              requiredGames: 7,
              predicate: {
                kind: "participant_numeric",
                field: "kills",
                operator: "gte",
                threshold: 10,
              },
              champion: null,
            },
            {
              kind: "condition",
              requiredGames: 3,
              predicate: {
                kind: "participant_rate",
                field: "cs_per_minute",
                operator: "gte",
                thresholdScaled: 700,
              },
              champion: null,
            },
          ],
        },
      ],
    });
  });

  test("defaults an unstated window length", () => {
    const canonical = canonicalizeDareTranslation(
      schema.parse(output({ windowDays: null })),
      SHORTLIST,
    );
    expect(canonical.windowDays).toBe(DARE_DEFAULT_WINDOW_DAYS);
  });

  test("next_game has no window to default", () => {
    const canonical = canonicalizeDareTranslation(
      schema.parse(
        output({
          horizonKind: "next_game",
          leaves: [booleanLeaf({ requiredGames: 1 })],
        }),
      ),
      SHORTLIST,
    );
    expect(canonical.horizonKind).toBe("next_game");
    expect(canonical.windowDays).toBeNull();
  });

  test("refuses to canonicalize an unmappable answer", () => {
    const modelOutput = schema.parse(
      output({
        unmappable: true,
        unmappableReason: "not expressible",
        targets: [],
        clauseCombinators: [],
        leaves: [],
      }),
    );
    expect(() => canonicalizeDareTranslation(modelOutput, SHORTLIST)).toThrow(
      "Cannot canonicalize an unmappable translation",
    );
  });
});
