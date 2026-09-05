import { describe, expect, test } from "vitest";
import {
  DareCompiledPlanV2Schema,
  DiscordAccountIdSchema,
} from "@scout-for-lol/data";
import { compileDarePreviewQueryV2 } from "#src/betting/dares/presentation/dare-preview-compiler-v2.ts";
import { TEST_LAKE_FILES, paramValues } from "#src/testing/test-lake-files.ts";

describe("Dare v2 lake compiler", () => {
  test("binds hostile target, predicate, queue, and date values", () => {
    const hostile = "'); DROP TABLE timeline_events; --";
    const plan = DareCompiledPlanV2Schema.parse({
      version: 2,
      maxEligibleGames: 100,
      gameSets: [
        {
          name: "one_game",
          targetKeys: ["target"],
          relationship: "independent",
          queues: ["solo"],
          predicate: {
            kind: "and",
            operands: [
              {
                kind: "comparison",
                value: {
                  kind: "participant",
                  target: "target",
                  field: "champion_name",
                },
                operator: "eq",
                // A real champion: a hostile string can no longer reach the
                // compiler through this field, because the contract schema now
                // rejects an unresolvable champion at authoring time. Binding is
                // still exercised below by the eventType and puuid values.
                threshold: "Ahri",
              },
              {
                kind: "comparison",
                value: {
                  kind: "timeline_event_count",
                  // A real event type: the contract schema now constrains this
                  // to the types Riot emits, so a hostile string cannot reach
                  // the compiler here either. The puuid below still carries it,
                  // which is what the binding assertions exercise.
                  eventType: "ITEM_PURCHASED",
                  target: null,
                  role: "killer",
                  afterMs: 1000,
                  beforeMs: 2000,
                  itemId: 3089,
                  monsterType: null,
                  buildingType: null,
                },
                operator: "gte",
                threshold: 1,
              },
              {
                kind: "comparison",
                value: {
                  kind: "arithmetic",
                  operator: "add",
                  left: {
                    kind: "participant",
                    target: "target",
                    field: "kills",
                  },
                  right: {
                    kind: "participant",
                    target: "target",
                    field: "assists",
                  },
                },
                operator: "gte",
                threshold: 5,
              },
            ],
          },
          projections: [],
          orderBy: "game_end_at_asc_match_id_asc",
          limit: 10,
        },
      ],
      result: {
        kind: "matching_games",
        gameSet: "one_game",
        operator: "gte",
        threshold: 1,
      },
    });
    const compiled = compileDarePreviewQueryV2({
      plan,
      targets: [
        {
          key: "target",
          discordId: DiscordAccountIdSchema.parse("160509172704739328"),
          playerId: 1,
          alias: "Target",
          accounts: [
            {
              puuid: hostile,
              trackingStartedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      files: TEST_LAKE_FILES,
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(compiled.sql).not.toContain(hostile);
    expect(paramValues(compiled.params)).toContain(hostile);
    expect(compiled.sql).toContain("timeline_coverage");
    expect(compiled.sql).toContain("COUNT(DISTINCT te.event_id)");
    expect(compiled.sql).toContain(
      "INNER JOIN timeline_event_participants AS tep ON tep.event_id = te.event_id AND tep.role = ?",
    );
    expect(compiled.sql).not.toContain("tep.puuid");
    expect(compiled.sql).toContain("(p0.kills + p0.assists)");
  });

  test("rejects a hostile event type before it can reach the compiler", () => {
    const hostile = "'); DROP TABLE timeline_events; --";
    expect(
      DareCompiledPlanV2Schema.safeParse({
        version: 2,
        maxEligibleGames: 100,
        gameSets: [
          {
            name: "one_game",
            targetKeys: ["target"],
            relationship: "independent",
            queues: ["solo"],
            predicate: {
              kind: "comparison",
              value: {
                kind: "timeline_event_count",
                eventType: hostile,
                target: "target",
                role: "subject",
                afterMs: null,
                beforeMs: null,
                itemId: null,
                monsterType: null,
                buildingType: null,
              },
              operator: "gte",
              threshold: 1,
            },
            projections: [],
            orderBy: "game_end_at_asc_match_id_asc",
            limit: 10,
          },
        ],
        result: {
          kind: "matching_games",
          gameSet: "one_game",
          operator: "gte",
          threshold: 1,
        },
      }).success,
    ).toBe(false);
  });

  test("rejects a hostile champion before it can reach the compiler", () => {
    const hostile = "'); DROP TABLE timeline_events; --";
    expect(
      DareCompiledPlanV2Schema.safeParse({
        version: 2,
        maxEligibleGames: 100,
        gameSets: [
          {
            name: "one_game",
            targetKeys: ["target"],
            relationship: "independent",
            queues: ["solo"],
            predicate: {
              kind: "comparison",
              value: {
                kind: "participant",
                target: "target",
                field: "champion_name",
              },
              operator: "eq",
              threshold: hostile,
            },
            projections: [],
            orderBy: "game_end_at_asc_match_id_asc",
            limit: 10,
          },
        ],
        result: {
          kind: "matching_games",
          gameSet: "one_game",
          operator: "gte",
          threshold: 1,
        },
      }).success,
    ).toBe(false);
  });
});
