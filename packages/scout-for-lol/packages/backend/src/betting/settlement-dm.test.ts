import { describe, expect, test } from "vitest";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import {
  buildSettlementDmMessages,
  type TeamRecipient,
} from "#src/betting/settlement-dm.ts";
import {
  deliverSettlementDms,
  type SettlementDmDeliveryDependencies,
} from "#src/betting/settlement-dm-delivery.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { SettlementBet } from "#src/betting/settlement-types.ts";
import type { ClosedPosition } from "#src/betting/sweep-types.ts";
import {
  bucksTestDiscordId,
  bucksTestRoster,
  bucksTestPuuid,
} from "#src/testing/bucks-fixtures.ts";
import { mockClient } from "#src/testing/discord-mocks.ts";
import { testGuildId } from "#src/testing/test-ids.ts";

const blueBettor = bucksTestDiscordId(0);
const redBettor = bucksTestDiscordId(1);
const bluePlayer = bucksTestDiscordId(2);
const redPlayer = bucksTestDiscordId(3);
const framing = { anchorTeamId: 100, mixedTeams: true } as const;

function bet(input: {
  id: number;
  discordId: string;
  teamId: 100 | 200;
  won?: boolean;
  refunded?: boolean;
  unmatchedStake?: number;
  isHouse?: boolean;
}): SettlementBet {
  const unmatchedStake = input.unmatchedStake ?? 0;
  const matchedStake = 10 - unmatchedStake;
  return {
    betId: input.id,
    bucksAccountId: input.id,
    discordId: input.discordId,
    isHouse: input.isHouse ?? false,
    predictedTeamId: input.teamId,
    submittedStake: 10,
    matchedStake,
    unmatchedStake,
    grossPayout: input.won === true ? 20 : matchedStake,
    houseCut: 0,
    payout: input.won === true ? 20 : matchedStake,
    winnings: input.won === true ? 10 : 0,
    won: input.won ?? false,
    refunded: input.refunded ?? false,
    subjectPuuid: bucksTestPuuid(input.id),
  };
}

function summary(
  bets: SettlementBet[],
  serverId: string,
  voidReason?: SettlementSummary["voidReason"],
): SettlementSummary {
  return {
    matchId: "match-1",
    serverId,
    winningTeamId: 100,
    voidReason,
    winnersPool: 10,
    losersPool: 10,
    houseCut: 0,
    bets,
  };
}

function build(input: {
  bets: SettlementBet[];
  playerRecipients?: TeamRecipient[];
  unmatchedPositions?: ClosedPosition[];
  parlay?: ParlaySettlementSummary;
  playerBetOutcomesEnabled?: boolean;
  voidReason?: SettlementSummary["voidReason"];
}) {
  return buildSettlementDmMessages({
    summary: summary(input.bets, "server-1", input.voidReason),
    includeOutcome: true,
    parlay: input.parlay,
    unmatchedPositions: input.unmatchedPositions ?? [],
    framing,
    receiptsEnabled: true,
    playerBetOutcomesEnabled: input.playerBetOutcomesEnabled ?? false,
    playerRecipients: input.playerRecipients ?? [],
  });
}

function deliveryInput(serverSuffix: string, bets: SettlementBet[]) {
  return {
    summary: summary(bets, testGuildId(serverSuffix)),
    includeOutcome: true,
    parlay: undefined,
    unmatchedPositions: [],
    roster: bucksTestRoster(),
  };
}

describe("Bryan Bucks settlement DMs", () => {
  test("sends a bettor who did not play one personal receipt", () => {
    const messages = build({
      bets: [bet({ id: 1, discordId: blueBettor, teamId: 100, won: true })],
    });

    expect(messages).toEqual([
      expect.objectContaining({
        recipientId: blueBettor,
        kind: "betting_settlement_receipt",
      }),
    ]);
    expect(messages[0]?.content).toContain("**Your bets**");
    expect(messages[0]?.content).toContain("Blue 10 BB → won 10 BB.");
    expect(messages[0]?.content).not.toContain("Bets on your team");
  });

  test("sends a player team-relative results for other human bettors", () => {
    const messages = build({
      bets: [bet({ id: 1, discordId: blueBettor, teamId: 100, won: true })],
      playerBetOutcomesEnabled: true,
      playerRecipients: [{ discordId: redPlayer, teamId: 200 }],
    });

    expect(messages).toEqual([
      expect.objectContaining({
        recipientId: blueBettor,
        kind: "betting_settlement_receipt",
      }),
      expect.objectContaining({
        recipientId: redPlayer,
        kind: "betting_player_bet_outcome",
      }),
    ]);
    expect(messages[1]?.content).toContain(
      `<@${blueBettor}> bet against your team and won 10 BB.`,
    );
  });

  test("does not create a team notice for an unlinked tracked player", () => {
    const messages = build({
      bets: [bet({ id: 1, discordId: blueBettor, teamId: 100, won: true })],
      playerBetOutcomesEnabled: true,
      // Account → Player has no Discord link, so no recipient is supplied.
      playerRecipients: [],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.recipientId).toBe(blueBettor);
  });

  test("combines a playing bettor's receipt and other bettors' lines once", () => {
    const messages = build({
      bets: [
        bet({ id: 1, discordId: bluePlayer, teamId: 100, won: true }),
        bet({ id: 2, discordId: redBettor, teamId: 200 }),
      ],
      playerBetOutcomesEnabled: true,
      playerRecipients: [{ discordId: bluePlayer, teamId: 100 }],
    });

    expect(messages).toHaveLength(2);
    const playerMessage = messages.find(
      (message) => message.recipientId === bluePlayer,
    );
    expect(playerMessage?.kind).toBe("betting_settlement_receipt");
    expect(playerMessage?.content).toContain("**Your bets**");
    expect(playerMessage?.content).toContain("**Bets on your team**");
    expect(playerMessage?.content).toContain(
      `<@${redBettor}> bet against your team and lost 10 BB.`,
    );
    expect(playerMessage?.content).not.toContain(
      `<@${bluePlayer}> bet for your team`,
    );
  });

  test("renders partial, unmatched, and voided outcome receipts", () => {
    const unmatched: ClosedPosition = {
      betId: 4,
      discordId: redBettor,
      teamId: 200,
      submittedStake: 6,
      matchedStake: 0,
      unmatchedStake: 6,
    };
    const messages = build({
      bets: [
        bet({
          id: 1,
          discordId: blueBettor,
          teamId: 100,
          won: true,
          unmatchedStake: 4,
        }),
        bet({ id: 2, discordId: redBettor, teamId: 200, refunded: true }),
      ],
      unmatchedPositions: [unmatched],
      voidReason: "remake",
    });

    expect(
      messages.find((message) => message.recipientId === blueBettor)?.content,
    ).toContain("4 BB was unmatched and returned.");
    const redMessage = messages.find(
      (message) => message.recipientId === redBettor,
    );
    expect(redMessage?.content).toContain(
      "10 BB → 10 BB matched and refunded.",
    );
    expect(redMessage?.content).toContain("6 BB was unmatched and refunded.");
  });

  test("excludes house bets and parlays from player-facing notices", () => {
    const parlay: ParlaySettlementSummary = {
      matchId: "match-1",
      serverId: "server-1",
      yesResult: true,
      voidReason: undefined,
      legs: [],
      messageRefs: [],
      bets: [
        {
          discordId: redBettor,
          side: "YES",
          stake: 5,
          grossPayout: 10,
          payout: 10,
          outcome: "won",
        },
      ],
    };
    const messages = build({
      bets: [
        bet({
          id: 3,
          discordId: blueBettor,
          teamId: 100,
          won: true,
          isHouse: true,
        }),
      ],
      parlay,
      playerBetOutcomesEnabled: true,
      playerRecipients: [{ discordId: bluePlayer, teamId: 100 }],
    });

    expect(messages).toEqual([
      expect.objectContaining({ recipientId: redBettor }),
    ]);
    expect(messages[0]?.content).toContain("YES 5 BB → won 5 BB.");
  });

  test("bounds a combined message to Discord's safe content limit", () => {
    const messages = build({
      bets: Array.from({ length: 300 }, (_, index) =>
        bet({ id: index + 1, discordId: blueBettor, teamId: 100, won: true }),
      ),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content.length).toBeLessThanOrEqual(1900);
    expect(messages[0]?.content.endsWith("...")).toBe(true);
  });

  test("continues after one DM delivery fails", async () => {
    let sends = 0;
    const dependencies: SettlementDmDeliveryDependencies = {
      client: mockClient(),
      isPolicyEnabled: async (name) => name === "betting_settlement_dm_enabled",
      observeBucksDelivery: async (_input, run) => run(),
      sendDm: async () => {
        sends++;
        if (sends === 1) {
          throw new Error("first DM failed");
        }
        return "sent";
      },
    };

    await deliverSettlementDms(
      deliveryInput("4", [
        bet({ id: 1, discordId: blueBettor, teamId: 100, won: true }),
        bet({ id: 2, discordId: redBettor, teamId: 200 }),
      ]),
      dependencies,
    );

    expect(sends).toBe(2);
  });

  test("observes settlement DMs and translates non-sent statuses into failures", async () => {
    let observed = 0;
    let rejected = 0;
    const dependencies: SettlementDmDeliveryDependencies = {
      client: mockClient(),
      isPolicyEnabled: async (name) => name === "betting_settlement_dm_enabled",
      observeBucksDelivery: async (_input, run) => {
        observed++;
        try {
          return await run();
        } catch (error) {
          rejected++;
          throw error;
        }
      },
      sendDm: async () => "dm_disabled",
    };

    await deliverSettlementDms(
      deliveryInput("5", [
        bet({ id: 1, discordId: blueBettor, teamId: 100, won: true }),
      ]),
      dependencies,
    );

    expect(observed).toBe(1);
    expect(rejected).toBe(1);
  });
});
