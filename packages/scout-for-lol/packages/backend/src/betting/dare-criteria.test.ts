import { describe, expect, test } from "vitest";
import {
  normalizeChampionName,
  RawMatchSchema,
  RawParticipantSchema,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import { ParticipantNumericFieldSchema } from "#src/betting/parlay-catalog.ts";
import {
  DARE_EXCLUDED_NUMERIC_FIELDS,
  DareConditionsSchema,
  DareNumericFieldSchema,
  dareLeavesInCanonicalOrder,
  dareSemanticIssues,
  evaluateDareGame,
  evaluateDarePredicate,
  evaluateDareTree,
  renderDareConditions,
  type DareConditions,
  type DareLeaf,
  type DarePredicate,
  type DareTargetIdentity,
} from "#src/betting/dare-criteria.ts";

const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

function baseParticipant(): RawParticipant {
  const participant = fixture.info.participants[0];
  if (participant === undefined) {
    throw new Error("fixture needs a participant");
  }
  return participant;
}

function participantWith(overrides: Record<string, unknown>): RawParticipant {
  return RawParticipantSchema.parse({ ...baseParticipant(), ...overrides });
}

function leaf(
  predicate: DarePredicate,
  overrides?: Partial<Pick<DareLeaf, "requiredGames" | "champion">>,
): DareLeaf {
  return {
    kind: "condition",
    requiredGames: overrides?.requiredGames ?? 1,
    predicate,
    champion: overrides?.champion ?? null,
  };
}

function tree(
  rootKind: "all" | "any",
  clauses: { kind: "all" | "any"; children: DareLeaf[] }[],
): DareConditions {
  return DareConditionsSchema.parse({
    version: 1,
    root: { kind: rootKind, clauses },
  });
}

const winsLeaf = leaf({
  kind: "participant_boolean",
  field: "win",
  expected: true,
});

describe("dare numeric catalog", () => {
  test("is exactly the canonical catalog minus the pinned exclusions", () => {
    const excluded = new Set<string>(DARE_EXCLUDED_NUMERIC_FIELDS);
    const expected = ParticipantNumericFieldSchema.options.filter(
      (field) => !excluded.has(field),
    );
    expect([...DareNumericFieldSchema.options].toSorted()).toEqual(
      [...expected].toSorted(),
    );
  });

  test("every exclusion names a real canonical field", () => {
    const canonical = new Set<string>(ParticipantNumericFieldSchema.options);
    for (const field of DARE_EXCLUDED_NUMERIC_FIELDS) {
      expect(canonical.has(field)).toBe(true);
    }
  });

  test("no ping field is darable", () => {
    for (const field of DareNumericFieldSchema.options) {
      expect(field.toLowerCase().includes("ping")).toBe(false);
    }
  });
});

describe("dare rate predicates", () => {
  test("700 scaled means exactly 7.00 CS per minute at the boundary", () => {
    // 210 CS over 1800 seconds is exactly 7.00 per minute.
    const participant = participantWith({
      totalMinionsKilled: 200,
      neutralMinionsKilled: 10,
      timePlayed: 1800,
    });
    const gte: DarePredicate = {
      kind: "participant_rate",
      field: "cs_per_minute",
      operator: "gte",
      thresholdScaled: 700,
    };
    const lte: DarePredicate = { ...gte, operator: "lte" };
    expect(evaluateDarePredicate(gte, participant)).toBe(true);
    expect(evaluateDarePredicate(lte, participant)).toBe(true);
    expect(
      evaluateDarePredicate({ ...gte, thresholdScaled: 701 }, participant),
    ).toBe(false);
    expect(
      evaluateDarePredicate({ ...lte, thresholdScaled: 699 }, participant),
    ).toBe(false);
  });

  test("timePlayed 0 has no rate: gte false, lte vacuously true", () => {
    const participant = participantWith({
      totalMinionsKilled: 300,
      neutralMinionsKilled: 0,
      timePlayed: 0,
    });
    expect(
      evaluateDarePredicate(
        {
          kind: "participant_rate",
          field: "cs_per_minute",
          operator: "gte",
          thresholdScaled: 0,
        },
        participant,
      ),
    ).toBe(false);
    expect(
      evaluateDarePredicate(
        {
          kind: "participant_rate",
          field: "damage_per_minute",
          operator: "lte",
          thresholdScaled: 0,
        },
        participant,
      ),
    ).toBe(true);
  });

  test("damage per minute cross-multiplies integer-exactly", () => {
    // 18,000 damage over 1200 seconds is exactly 900.00 per minute.
    const participant = participantWith({
      totalDamageDealtToChampions: 18_000,
      timePlayed: 1200,
    });
    const gte: DarePredicate = {
      kind: "participant_rate",
      field: "damage_per_minute",
      operator: "gte",
      thresholdScaled: 90_000,
    };
    expect(evaluateDarePredicate(gte, participant)).toBe(true);
    expect(
      evaluateDarePredicate({ ...gte, thresholdScaled: 90_001 }, participant),
    ).toBe(false);
  });

  test("KDA treats zero deaths as one, the perfect-game convention", () => {
    const participant = participantWith({ kills: 4, assists: 2, deaths: 0 });
    const gte: DarePredicate = {
      kind: "participant_rate",
      field: "kda",
      operator: "gte",
      thresholdScaled: 600,
    };
    expect(evaluateDarePredicate(gte, participant)).toBe(true);
    expect(
      evaluateDarePredicate({ ...gte, thresholdScaled: 601 }, participant),
    ).toBe(false);
    // With deaths, the divisor is the real count: (4+2)/3 = 2.00.
    const withDeaths = participantWith({ kills: 4, assists: 2, deaths: 3 });
    expect(
      evaluateDarePredicate({ ...gte, thresholdScaled: 200 }, withDeaths),
    ).toBe(true);
    expect(
      evaluateDarePredicate({ ...gte, thresholdScaled: 201 }, withDeaths),
    ).toBe(false);
  });

  test("numeric and boolean predicates read the shared catalog values", () => {
    const participant = participantWith({ kills: 7, win: true });
    expect(
      evaluateDarePredicate(
        {
          kind: "participant_numeric",
          field: "kills",
          operator: "gte",
          threshold: 7,
        },
        participant,
      ),
    ).toBe(true);
    expect(
      evaluateDarePredicate(
        {
          kind: "participant_numeric",
          field: "kills",
          operator: "eq",
          threshold: 6,
        },
        participant,
      ),
    ).toBe(false);
    expect(
      evaluateDarePredicate(
        { kind: "participant_boolean", field: "win", expected: true },
        participant,
      ),
    ).toBe(true);
  });
});

describe("canonical leaf order", () => {
  test("is depth-first, clause order then child order — pinned forever", () => {
    const killsLeaf = leaf({
      kind: "participant_numeric",
      field: "kills",
      operator: "gte",
      threshold: 10,
    });
    const assistsLeaf = leaf({
      kind: "participant_numeric",
      field: "assists",
      operator: "gte",
      threshold: 5,
    });
    const csLeaf = leaf({
      kind: "participant_rate",
      field: "cs_per_minute",
      operator: "gte",
      thresholdScaled: 700,
    });
    const conditions = tree("all", [
      { kind: "any", children: [killsLeaf, assistsLeaf] },
      { kind: "all", children: [csLeaf, winsLeaf] },
    ]);
    const flattened = dareLeavesInCanonicalOrder(conditions).map(
      (entry) => entry.predicate.field,
    );
    // BucksDareGame.leafHits indexes align to exactly this sequence.
    expect(flattened).toEqual(["kills", "assists", "cs_per_minute", "win"]);
  });
});

function targetFor(puuid: string, alias: string): DareTargetIdentity {
  return {
    discordId: `discord-${alias}`,
    alias,
    accounts: [{ puuid, trackingStartedAt: new Date(0).toISOString() }],
  };
}

function puuidAt(match: RawMatch, index: number): string {
  const participant = match.info.participants[index];
  if (participant === undefined) {
    throw new Error(`fixture has no participant ${index.toString()}`);
  }
  return participant.puuid;
}

function matchWithParticipantOverrides(
  overridesByIndex: Record<number, Record<string, unknown>>,
): RawMatch {
  const parsed = RawMatchSchema.parse(structuredClone(fixture));
  const participants = parsed.info.participants.map((participant, index) => {
    const overrides = overridesByIndex[index];
    return overrides === undefined
      ? participant
      : RawParticipantSchema.parse({ ...participant, ...overrides });
  });
  return RawMatchSchema.parse({
    ...parsed,
    info: { ...parsed.info, participants },
  });
}

describe("evaluateDareGame group semantics", () => {
  const winAll = tree("all", [{ kind: "all", children: [winsLeaf] }]);

  test("a target absent from the match makes the game a non-candidate", () => {
    const match = matchWithParticipantOverrides({});
    const targets = [
      targetFor(puuidAt(match, 0), "present"),
      targetFor("p-not-in-this-match".padEnd(78, "x"), "absent"),
    ];
    expect(evaluateDareGame(winAll, targets, match)).toBeUndefined();
  });

  test("targets split across teams make the game a non-candidate", () => {
    const match = matchWithParticipantOverrides({});
    const blue = match.info.participants.findIndex(
      (participant) => participant.teamId === 100,
    );
    const red = match.info.participants.findIndex(
      (participant) => participant.teamId === 200,
    );
    const targets = [
      targetFor(puuidAt(match, blue), "blue"),
      targetFor(puuidAt(match, red), "red"),
    ];
    expect(evaluateDareGame(winAll, targets, match)).toBeUndefined();
  });

  test("a leaf hits only when every target satisfies it", () => {
    const match = matchWithParticipantOverrides({
      0: { kills: 10, teamId: 100 },
      1: { kills: 0, teamId: 100 },
    });
    const conditions = tree("all", [
      {
        kind: "all",
        children: [
          leaf({
            kind: "participant_numeric",
            field: "kills",
            operator: "gte",
            threshold: 5,
          }),
        ],
      },
    ]);
    const both = [
      targetFor(puuidAt(match, 0), "carry"),
      targetFor(puuidAt(match, 1), "support"),
    ];
    const evaluation = evaluateDareGame(conditions, both, match);
    expect(evaluation).toBeDefined();
    expect(evaluation?.leafHits).toEqual([false]);
    const solo = [targetFor(puuidAt(match, 0), "carry")];
    expect(evaluateDareGame(conditions, solo, match)?.leafHits).toEqual([true]);
  });

  test("a champion filter compares normalized Data Dragon keys", () => {
    const match = matchWithParticipantOverrides({
      0: { championName: "MonkeyKing", win: true },
    });
    const onWukong = tree("all", [
      {
        kind: "all",
        children: [
          leaf(
            { kind: "participant_boolean", field: "win", expected: true },
            { champion: normalizeChampionName("wukong") },
          ),
        ],
      },
    ]);
    const target = [targetFor(puuidAt(match, 0), "wukong-enjoyer")];
    // "wukong" normalizes to the Data Dragon key "MonkeyKing" and matches.
    expect(normalizeChampionName("wukong")).toBe("MonkeyKing");
    const evaluation = evaluateDareGame(onWukong, target, match);
    expect(
      evaluation?.leafHits.every(Boolean) === true &&
        evaluation.snapshot.targets[0]?.champion === "MonkeyKing",
    ).toBe(true);

    const onGaren = tree("all", [
      {
        kind: "all",
        children: [
          leaf(
            { kind: "participant_boolean", field: "win", expected: true },
            { champion: "Garen" },
          ),
        ],
      },
    ]);
    expect(evaluateDareGame(onGaren, target, match)?.leafHits).toEqual([false]);
  });
});

function twoLeafTree(
  rootKind: "all" | "any",
  clauseKind: "all" | "any",
): DareConditions {
  return tree(rootKind, [
    {
      kind: clauseKind,
      children: [
        leaf(
          {
            kind: "participant_numeric",
            field: "kills",
            operator: "gte",
            threshold: 1,
          },
          { requiredGames: 2 },
        ),
        leaf({
          kind: "participant_boolean",
          field: "win",
          expected: true,
        }),
      ],
    },
  ]);
}

describe("evaluateDareTree", () => {
  test("a leaf is true once its hit count reaches requiredGames", () => {
    const conditions = twoLeafTree("all", "all");
    expect(evaluateDareTree(conditions, [{ leafHits: [true, false] }])).toEqual(
      { achieved: false, leafCounts: [1, 0] },
    );
    expect(
      evaluateDareTree(conditions, [
        { leafHits: [true, false] },
        { leafHits: [true, true] },
      ]),
    ).toEqual({ achieved: true, leafCounts: [2, 1] });
  });

  test("any-clauses need one true child, all-roots need every clause", () => {
    const anyClause = twoLeafTree("all", "any");
    expect(evaluateDareTree(anyClause, [{ leafHits: [false, true] }])).toEqual({
      achieved: true,
      leafCounts: [0, 1],
    });

    const twoClauses = tree("any", [
      { kind: "all", children: [winsLeaf] },
      {
        kind: "all",
        children: [
          leaf({
            kind: "participant_numeric",
            field: "kills",
            operator: "gte",
            threshold: 100,
          }),
        ],
      },
    ]);
    expect(
      evaluateDareTree(twoClauses, [{ leafHits: [false, true] }]).achieved,
    ).toBe(true);
    expect(
      evaluateDareTree(twoClauses, [{ leafHits: [false, false] }]).achieved,
    ).toBe(false);
  });

  test("monotone: adding rows can never flip achieved back to false", () => {
    const shapes: DareConditions[] = [
      twoLeafTree("all", "all"),
      twoLeafTree("all", "any"),
      twoLeafTree("any", "all"),
      twoLeafTree("any", "any"),
    ];
    const rows = [
      { leafHits: [true, false] },
      { leafHits: [false, true] },
      { leafHits: [true, true] },
      { leafHits: [false, false] },
    ];
    for (const conditions of shapes) {
      for (let size = 0; size <= rows.length; size += 1) {
        const base = rows.slice(0, size);
        const before = evaluateDareTree(conditions, base).achieved;
        for (const extra of rows) {
          const after = evaluateDareTree(conditions, [...base, extra]);
          if (before) {
            expect(after.achieved).toBe(true);
          }
        }
      }
    }
  });
});

describe("renderDareConditions", () => {
  test("renders a single-leaf dare as one sentence", () => {
    const conditions = tree("all", [
      {
        kind: "all",
        children: [
          leaf(
            { kind: "participant_boolean", field: "win", expected: true },
            { requiredGames: 7, champion: "MonkeyKing" },
          ),
        ],
      },
    ]);
    expect(renderDareConditions(conditions, ["Virmel"])).toBe(
      "at least 7 games where Virmel wins on Wukong",
    );
  });

  test("renders a tree with indentation and a group footer", () => {
    const conditions = tree("any", [
      {
        kind: "all",
        children: [
          winsLeaf,
          leaf({
            kind: "participant_numeric",
            field: "kills",
            operator: "gte",
            threshold: 10,
          }),
        ],
      },
      {
        kind: "all",
        children: [
          leaf({
            kind: "participant_rate",
            field: "cs_per_minute",
            operator: "gte",
            thresholdScaled: 725,
          }),
        ],
      },
    ]);
    expect(renderDareConditions(conditions, ["A", "B"])).toBe(
      [
        "ANY of:",
        "- ALL of:",
        "  - at least 1 game where A and B wins",
        "  - at least 1 game where A and B gets at least 10 kills",
        "- at least 1 game where A and B averages at least 7.25 CS per minute",
        "Counts only games where A and B play together on the same team.",
      ].join("\n"),
    );
  });
});

describe("dareSemanticIssues", () => {
  const conditions = tree("all", [{ kind: "all", children: [winsLeaf] }]);
  const multiGame = tree("all", [
    {
      kind: "all",
      children: [
        leaf(
          { kind: "participant_boolean", field: "win", expected: true },
          { requiredGames: 3 },
        ),
      ],
    },
  ]);
  const puuidA = "a".repeat(78);
  const puuidB = "b".repeat(78);

  test("accepts a well-formed dare", () => {
    expect(
      dareSemanticIssues(
        [targetFor(puuidA, "one"), targetFor(puuidB, "two")],
        conditions,
        "window",
      ),
    ).toEqual([]);
  });

  test("rejects duplicate targets", () => {
    const duplicated = targetFor(puuidA, "same");
    expect(
      dareSemanticIssues([duplicated, duplicated], conditions, "window").length,
    ).toBeGreaterThan(0);
  });

  test("rejects targets whose frozen account sets overlap", () => {
    expect(
      dareSemanticIssues(
        [targetFor(puuidA, "one"), targetFor(puuidA, "two")],
        conditions,
        "window",
      ).length,
    ).toBeGreaterThan(0);
  });

  // A leaf hits only when EVERY target played the pinned champion, and the
  // eligible queues are all draft modes where a champion appears at most once
  // per match — so a group dare on a champion is unachievable from creation.
  const championBound = tree("all", [
    { kind: "all", children: [leaf(winsLeaf.predicate, { champion: "Ahri" })] },
  ]);

  test("rejects a champion-bound leaf on a multi-target dare", () => {
    const issues = dareSemanticIssues(
      [targetFor(puuidA, "one"), targetFor(puuidB, "two")],
      championBound,
      "window",
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("cannot pin a champion");
  });

  test("accepts the same champion-bound leaf on a single-target dare", () => {
    expect(
      dareSemanticIssues([targetFor(puuidA, "one")], championBound, "window"),
    ).toEqual([]);
  });

  test("rejects next_game with any multi-game leaf", () => {
    expect(
      dareSemanticIssues([targetFor(puuidA, "one")], multiGame, "next_game")
        .length,
    ).toBeGreaterThan(0);
    expect(
      dareSemanticIssues([targetFor(puuidA, "one")], multiGame, "window"),
    ).toEqual([]);
  });
});
