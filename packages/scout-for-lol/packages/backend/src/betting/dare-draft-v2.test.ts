import { describe, expect, test } from "vitest";
import {
  DareCompiledPlanV2Schema,
  DareTargetBindingV2Schema,
} from "@scout-for-lol/data";
import { darePlanSemanticIssues } from "#src/betting/dare-contract-compiler-v2.ts";
import { prepareDareDraftV2 } from "#src/betting/dare-draft-v2.ts";

describe("prepareDareDraftV2", () => {
  test("rejects timeline projections for queues without retained timelines", () => {
    const plan = DareCompiledPlanV2Schema.parse({
      version: 2,
      maxEligibleGames: 1,
      gameSets: [
        {
          name: "arena_games",
          targetKeys: ["T1"],
          relationship: "independent",
          queues: ["arena"],
          predicate: {
            kind: "comparison",
            value: { kind: "participant", target: "T1", field: "kills" },
            operator: "gte",
            threshold: 1,
          },
          projections: [
            {
              name: "early_kills",
              value: {
                kind: "timeline_event_count",
                eventType: "CHAMPION_KILL",
                target: "T1",
                role: "killer",
                afterMs: null,
                beforeMs: 600_000,
                itemId: null,
                monsterType: null,
                buildingType: null,
              },
            },
          ],
          orderBy: "game_end_at_asc_match_id_asc",
          limit: 1,
        },
      ],
      result: {
        kind: "aggregate",
        gameSet: "arena_games",
        projection: "early_kills",
        function: "sum",
        operator: "gte",
        threshold: 1,
      },
    });
    const target = DareTargetBindingV2Schema.parse({
      key: "T1",
      discordId: "20000000000000000",
      playerId: 1,
      alias: "Virmel",
      accounts: [
        {
          puuid: "virmel-puuid",
          trackingStartedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(
      prepareDareDraftV2(
        {
          originalText: "Get an early kill in arena.",
          plan,
          targets: [target],
          deadlineSpec: { kind: "relative", days: 7 },
          openingStake: 10,
        },
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toMatchObject({
      kind: "invalid",
      issues: [
        "Game set arena_games requests timeline evidence from an unsupported queue.",
      ],
    });
  });

  test("rejects opponent sets that cannot preserve pairwise semantics", () => {
    const plan = DareCompiledPlanV2Schema.parse({
      version: 2,
      maxEligibleGames: 1,
      gameSets: [
        {
          name: "opponent_games",
          targetKeys: ["T1", "T2", "T3"],
          relationship: "opponents",
          queues: ["solo"],
          predicate: {
            kind: "comparison",
            value: { kind: "participant", target: "T1", field: "kills" },
            operator: "gte",
            threshold: 1,
          },
          projections: [],
          orderBy: "game_end_at_asc_match_id_asc",
          limit: 1,
        },
      ],
      result: {
        kind: "matching_games",
        gameSet: "opponent_games",
        operator: "gte",
        threshold: 1,
      },
    });

    expect(
      darePlanSemanticIssues(
        plan,
        ["T1", "T2", "T3"].map((key, index) =>
          DareTargetBindingV2Schema.parse({
            key,
            discordId: `2000000000000000${index.toString()}`,
            playerId: index + 1,
            alias: `Target ${index.toString()}`,
            accounts: [
              {
                puuid: `target-${index.toString()}-puuid`,
                trackingStartedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        ),
      ),
    ).toContain(
      "Opponent game set opponent_games must bind exactly two targets.",
    );
  });

  test("rejects drafts whose exact public callout would exceed Discord's limit", () => {
    const repeatedCondition = {
      kind: "comparison",
      value: { kind: "participant", target: "T1", field: "kills" },
      operator: "gte",
      threshold: 1,
    } as const;
    const plan = DareCompiledPlanV2Schema.parse({
      version: 2,
      maxEligibleGames: 1,
      gameSets: [
        {
          name: "verbose_games",
          targetKeys: ["T1"],
          relationship: "independent",
          queues: ["solo"],
          predicate: {
            kind: "and",
            operands: Array.from({ length: 59 }, () => repeatedCondition),
          },
          projections: [],
          orderBy: "game_end_at_asc_match_id_asc",
          limit: 1,
        },
      ],
      result: {
        kind: "matching_games",
        gameSet: "verbose_games",
        operator: "gte",
        threshold: 1,
      },
    });
    const target = DareTargetBindingV2Schema.parse({
      key: "T1",
      discordId: "20000000000000000",
      playerId: 1,
      alias: "Virmel",
      accounts: [
        {
          puuid: "virmel-puuid",
          trackingStartedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(
      prepareDareDraftV2(
        {
          originalText: "Repeat a deliberately verbose achievement.",
          plan,
          targets: [target],
          deadlineSpec: { kind: "relative", days: 7 },
          openingStake: 10,
        },
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toMatchObject({
      kind: "invalid",
      issues: [
        "The public Dare callout exceeds Discord's 2000-character limit.",
      ],
    });
  });
});
