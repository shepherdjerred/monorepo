import { describe, expect, test } from "bun:test";
import {
  ParlayConditionSchema,
  PARLAY_SUBJECT_ALIAS_MAX_LENGTH,
  ParlaySubjectsSchema,
} from "#src/betting/parlay-criteria.ts";
import {
  announceParlaySettlements,
  formatParlaySettlement,
  formatParlaySettlementChunks,
} from "#src/betting/parlay-announce.ts";
import { buildParlayButtons } from "#src/betting/parlay-components.ts";
import { buildParlayContent } from "#src/betting/parlay-line.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";

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

function largeSettlementSummary(
  messageRefs: ParlaySettlementSummary["messageRefs"] = [],
): ParlaySettlementSummary {
  const renderedLegs = Array.from(
    { length: 6 },
    (_, index) =>
      `${"a".repeat(PARLAY_SUBJECT_ALIAS_MAX_LENGTH)} ${"resolves a deliberately verbose canonical result ".repeat(4)}leg ${(index + 1).toString()}`,
  );
  return {
    matchId: "NA1_42",
    serverId: "1337623164146155593",
    yesResult: true,
    voidReason: undefined,
    messageRefs,
    legs: renderedLegs.map((rendered) => ({
      condition: participantCondition,
      rendered,
      actualValue: 2_147_483_647,
      passed: true,
    })),
    bets: Array.from({ length: 15 }, (_, index) => ({
      discordId: (1_000_000_000_000_000_000n + BigInt(index)).toString(),
      side: "YES",
      stake: 2_147_483_647,
      grossPayout: 2_147_483_647,
      payout: 2_147_483_647,
      outcome: "won",
    })),
  };
}

describe("parlay Discord experience", () => {
  test("renders a dedicated live-market follow-up and five actions", () => {
    const content = buildParlayContent({
      criteria,
      subjects,
      closesAt: new Date("2026-08-18T12:05:00.000Z"),
      marketState: "open",
      positions: [],
    });
    expect(content).toContain("Bryan gets at least 5 kills");
    expect(content).toContain("Their team gets first baron");
    expect(content).toContain("YES** 40% (2.50×)");
    expect(content).toContain("NO** 60% (1.67×)");
    expect(content).toContain("live in-play market");
    expect(content).toContain("<t:1787054700:R>");

    const row = buildParlayButtons({ matchId: "NA1_42" }).toJSON();
    expect(
      row.components.map((component) =>
        "label" in component ? component.label : undefined,
      ),
    ).toEqual(["YES 1", "YES 5", "NO 1", "NO 5", "Cancel"]);
  });

  test("keeps the largest supported publication within one Discord message", () => {
    const longSubjects = ParlaySubjectsSchema.parse([
      {
        key: "P1",
        puuid: "test-puuid".padEnd(78, "x"),
        alias: "a".repeat(PARLAY_SUBJECT_ALIAS_MAX_LENGTH),
      },
    ]);
    const longCriteria = {
      version: 1 as const,
      yesProbabilityBps: 4000,
      conditions: [
        "magicDamageDealtToChampions",
        "physicalDamageDealtToChampions",
        "totalDamageShieldedOnTeammates",
        "totalEnemyJungleMinionsKilled",
        "totalAllyJungleMinionsKilled",
        "visionWardsBoughtInGame",
      ].map((field) =>
        ParlayConditionSchema.parse({
          kind: "participant_numeric",
          subject: "P1",
          field,
          operator: "gte",
          threshold: 10_000,
        }),
      ),
    };
    const content = buildParlayContent({
      criteria: longCriteria,
      subjects: longSubjects,
      closesAt: new Date("2026-08-18T12:05:00.000Z"),
      marketState: "open",
      positions: [],
    });
    expect(content.length).toBeLessThanOrEqual(1900);
    expect(content).toContain("a".repeat(PARLAY_SUBJECT_ALIAS_MAX_LENGTH));
  });

  test("rejects subject aliases longer than the publication contract", () => {
    expect(() =>
      ParlaySubjectsSchema.parse([
        {
          key: "P1",
          puuid: "test-puuid".padEnd(78, "x"),
          alias: "a".repeat(PARLAY_SUBJECT_ALIAS_MAX_LENGTH + 1),
        },
      ]),
    ).toThrow();
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

  test("chunks a large settlement without dropping legs or positions", () => {
    const summary = largeSettlementSummary();
    const renderedLegs = summary.legs.map((leg) => leg.rendered);
    const chunks = formatParlaySettlementChunks(summary);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1900)).toBe(true);
    const combined = chunks.join("\n");
    for (const rendered of renderedLegs) {
      expect(combined).toContain(rendered);
    }
    expect(combined).toContain("<@1000000000000000014>");
  });

  test("attempts later settlement chunks after one send fails", async () => {
    const summary = largeSettlementSummary([
      {
        channelId: "1337623164146155593",
        messageId: "1337623164146155594",
      },
    ]);
    const chunks = formatParlaySettlementChunks(summary);
    let attempts = 0;
    await announceParlaySettlements([summary], {
      sendMessage: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("transient Discord failure");
        }
      },
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(attempts).toBe(chunks.length);
  });
});
