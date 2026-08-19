import { describe, expect, test } from "bun:test";
import {
  ParlayConditionSchema,
  ParlaySubjectsSchema,
} from "#src/betting/parlay-criteria.ts";
import { formatParlaySettlement } from "#src/betting/parlay-announce.ts";
import { buildParlayButtons } from "#src/betting/parlay-components.ts";
import { buildParlayMessage } from "#src/betting/parlay-publish.ts";

const subjects = ParlaySubjectsSchema.parse([
  {
    key: "P1",
    puuid: "test-puuid".padEnd(78, "x"),
    alias: "Bryan",
  },
]);

const participantCondition = ParlayConditionSchema.parse({
  kind: "participant_numeric",
  subject: "P1",
  field: "kills",
  operator: "gte",
  threshold: 5,
});
const objectiveCondition = ParlayConditionSchema.parse({
  kind: "team_objective_first",
  team: "selected",
  objective: "baron",
  expected: true,
});
const criteria = {
  version: 1 as const,
  yesProbabilityBps: 4000,
  conditions: [participantCondition, objectiveCondition],
};

describe("parlay Discord experience", () => {
  test("renders a dedicated live-market follow-up and five actions", () => {
    const content = buildParlayMessage({
      criteria,
      subjects,
      closesAt: new Date("2026-08-18T12:05:00.000Z"),
    });
    expect(content).toContain("Bryan gets at least 5 kills");
    expect(content).toContain("Their team gets first baron");
    expect(content).toContain("YES** 40% (2.50×)");
    expect(content).toContain("NO** 60% (1.67×)");
    expect(content).toContain("Live/in-play market");
    expect(content).toContain("<t:1787054700:R>");

    const row = buildParlayButtons({ matchId: "NA1_42" }).toJSON();
    expect(
      row.components.map((component) =>
        "label" in component ? component.label : undefined,
      ),
    ).toEqual(["YES 1", "YES 5", "NO 1", "NO 5", "Cancel"]);
  });

  test("renders leg actuals, the overall side, positions, and payouts", () => {
    const content = formatParlaySettlement({
      matchId: "NA1_42",
      serverId: "1337623164146155593",
      yesResult: false,
      voidReason: undefined,
      messageRefs: [],
      legs: [
        {
          condition: participantCondition,
          rendered: "Bryan gets at least 5 kills",
          actualValue: 4,
          passed: false,
        },
        {
          condition: objectiveCondition,
          rendered: "Their team gets first baron",
          actualValue: true,
          passed: true,
        },
      ],
      bets: [
        {
          discordId: "test-discord-account",
          side: "NO",
          stake: 25,
          grossPayout: 42,
          payout: 42,
          outcome: "won",
        },
      ],
    });
    expect(content).toContain("actual **4**");
    expect(content).toContain("actual **true**");
    expect(content).toContain("Overall result: **NO**");
    expect(content).toContain("NO 25 BB → won, 42 BB");
  });
});
