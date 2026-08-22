import { describe, expect, test } from "vitest";
import {
  ParlayConditionSchema,
  PARLAY_SUBJECT_ALIAS_MAX_LENGTH,
  ParlaySubjectsSchema,
} from "#src/betting/parlay-criteria.ts";
import { buildSettlementMessage } from "#src/betting/outcome-message.ts";
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

function parlayEmbed(
  parlay: Parameters<typeof buildSettlementMessage>[0]["parlay"],
) {
  const message = buildSettlementMessage({
    summary: {
      matchId: "NA1_42",
      serverId: "1337623164146155593",
      winningTeamId: undefined,
      voidReason: undefined,
      winnersPool: 0,
      losersPool: 0,
      houseCut: 0,
      bets: [],
    },
    includeOutcome: false,
    parlay,
    framing: undefined,
    earnings: [],
    predictionSentence: undefined,
    predictionVerdictLine: undefined,
  });
  const embed = message.embeds?.[0];
  if (embed === undefined) {
    throw new Error("expected a settlement embed");
  }
  return JSON.stringify(embed);
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

  // The parlay result is now a section on the settlement embed rather than its
  // own message, so these assert the embed's parlay fields.
  test("renders leg actuals, the overall side, positions, and payouts", () => {
    const rendered = parlayEmbed({
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
    expect(rendered).toContain("Parlay — NO (1/2 legs)");
    expect(rendered).toContain("Bryan gets at least 5 kills — 4");
    expect(rendered).toContain("Their team gets first baron — true");
    expect(rendered).toContain("NO 25 → won, **42 BB**");
  });

  test("names a void in prose rather than leaking the enum", () => {
    const rendered = parlayEmbed({
      matchId: "NA1_42",
      serverId: "1337623164146155593",
      yesResult: undefined,
      voidReason: "expired",
      messageRefs: [],
      legs: [],
      bets: [],
    });
    expect(rendered).toContain("Parlay — voided (the game never resolved)");
    expect(rendered).not.toContain("expired");
  });

  // Merging the parlay into the outcome embed made Discord's 6000-character
  // ceiling reachable. Throwing there would discard a one-shot settlement, so
  // the sections degrade in order instead.
  test("degrades an oversized settlement instead of throwing", () => {
    const summary = largeSettlementSummary();
    const rendered = parlayEmbed(summary);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toContain("Parlay");
  });
});
