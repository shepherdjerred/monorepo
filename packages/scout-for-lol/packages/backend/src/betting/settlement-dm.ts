import { RiotTeamIdSchema, type RiotTeamId } from "@scout-for-lol/data";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPosition } from "#src/betting/sweep.ts";
import { outcomeLabel, type OutcomeFraming } from "#src/betting/team.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";

const MAX_SETTLEMENT_DM_LENGTH = 1900;
const TRUNCATION_SUFFIX = "...";

export type SettlementDmKind =
  "betting_settlement_receipt" | "betting_player_bet_outcome";

export type SettlementDmMessage = {
  recipientId: string;
  kind: SettlementDmKind;
  content: string;
};

export type TeamRecipient = {
  discordId: string;
  teamId: RiotTeamId;
};

type OutcomePosition = {
  bettorId: string;
  teamId: RiotTeamId;
  submittedStake: number;
  matchedStake: number;
  unmatchedStake: number;
  outcome: "won" | "lost" | "refunded" | "unmatched";
  winnings: number;
};

type RecipientDraft = {
  ownLines: string[];
  teamLines: string[];
};

function outcomePositions(input: {
  summary: SettlementSummary;
  includeOutcome: boolean;
  unmatchedPositions: readonly ClosedPosition[];
}): OutcomePosition[] {
  if (!input.includeOutcome) {
    return [];
  }
  const settled = input.summary.bets
    .filter((bet) => !bet.isHouse)
    .map((bet): OutcomePosition => ({
      bettorId: bet.discordId,
      teamId: RiotTeamIdSchema.parse(bet.predictedTeamId),
      submittedStake: bet.submittedStake,
      matchedStake: bet.matchedStake,
      unmatchedStake: bet.unmatchedStake,
      outcome: bet.refunded ? "refunded" : bet.won ? "won" : "lost",
      winnings: bet.winnings,
    }));
  const settledIds = new Set(
    input.summary.bets.filter((bet) => !bet.isHouse).map((bet) => bet.betId),
  );
  const unmatched = input.unmatchedPositions
    .filter((position) => !settledIds.has(position.betId))
    .map((position): OutcomePosition => ({
      bettorId: position.discordId,
      teamId: position.teamId,
      submittedStake: position.submittedStake,
      matchedStake: position.matchedStake,
      unmatchedStake: position.unmatchedStake,
      outcome: "unmatched",
      winnings: 0,
    }));
  return [...settled, ...unmatched];
}

function returnedSuffix(position: OutcomePosition): string {
  return position.unmatchedStake > 0
    ? ` ${position.unmatchedStake.toString()} BB was unmatched and returned.`
    : "";
}

function ownOutcomeLine(
  position: OutcomePosition,
  framing: OutcomeFraming | undefined,
): string {
  const side = outcomeLabel(position.teamId, framing);
  if (position.outcome === "unmatched") {
    return `• ${side} ${position.submittedStake.toString()} BB was unmatched and refunded.`;
  }
  if (position.outcome === "refunded") {
    return `• ${side} ${position.submittedStake.toString()} BB → ${position.matchedStake.toString()} BB matched and refunded.${returnedSuffix(position)}`;
  }
  if (position.outcome === "won") {
    return `• ${side} ${position.submittedStake.toString()} BB → won ${position.winnings.toString()} BB.${returnedSuffix(position)}`;
  }
  return `• ${side} ${position.submittedStake.toString()} BB → lost ${position.matchedStake.toString()} BB.${returnedSuffix(position)}`;
}

function teamOutcomeLine(
  position: OutcomePosition,
  recipientTeamId: RiotTeamId,
): string {
  const direction = position.teamId === recipientTeamId ? "for" : "against";
  const bettor = `<@${position.bettorId}>`;
  if (position.outcome === "unmatched") {
    return `• ${bettor} bet ${direction} your team, but ${position.submittedStake.toString()} BB was unmatched and refunded.`;
  }
  if (position.outcome === "refunded") {
    return `• ${bettor} bet ${direction} your team and received a ${position.matchedStake.toString()} BB refund.${returnedSuffix(position)}`;
  }
  if (position.outcome === "won") {
    return `• ${bettor} bet ${direction} your team and won ${position.winnings.toString()} BB.${returnedSuffix(position)}`;
  }
  return `• ${bettor} bet ${direction} your team and lost ${position.matchedStake.toString()} BB.${returnedSuffix(position)}`;
}

function ownParlayLine(bet: ParlaySettlementSummary["bets"][number]): string {
  if (bet.outcome === "won") {
    return `• ${bet.side} ${bet.stake.toString()} BB → won ${(bet.payout - bet.stake).toString()} BB.`;
  }
  if (bet.outcome === "refunded") {
    return `• ${bet.side} ${bet.stake.toString()} BB was refunded.`;
  }
  return `• ${bet.side} ${bet.stake.toString()} BB → lost ${bet.stake.toString()} BB.`;
}

function draftFor(
  drafts: Map<string, RecipientDraft>,
  recipientId: string,
): RecipientDraft {
  const existing = drafts.get(recipientId);
  if (existing !== undefined) {
    return existing;
  }
  const created: RecipientDraft = { ownLines: [], teamLines: [] };
  drafts.set(recipientId, created);
  return created;
}

/** Build one bounded, private result message per recipient and settled match. */
export function buildSettlementDmMessages(input: {
  summary: SettlementSummary;
  includeOutcome: boolean;
  parlay: ParlaySettlementSummary | undefined;
  unmatchedPositions: readonly ClosedPosition[];
  framing: OutcomeFraming | undefined;
  receiptsEnabled: boolean;
  playerBetOutcomesEnabled: boolean;
  playerRecipients: readonly TeamRecipient[];
}): SettlementDmMessage[] {
  const drafts = new Map<string, RecipientDraft>();
  const outcomes = outcomePositions(input);

  if (input.receiptsEnabled) {
    for (const position of outcomes) {
      draftFor(drafts, position.bettorId).ownLines.push(
        ownOutcomeLine(position, input.framing),
      );
    }
    for (const bet of input.parlay?.bets ?? []) {
      draftFor(drafts, bet.discordId).ownLines.push(ownParlayLine(bet));
    }
  }

  if (input.playerBetOutcomesEnabled) {
    for (const position of outcomes) {
      for (const recipient of input.playerRecipients) {
        if (recipient.discordId === position.bettorId) {
          continue;
        }
        draftFor(drafts, recipient.discordId).teamLines.push(
          teamOutcomeLine(position, recipient.teamId),
        );
      }
    }
  }

  return [...drafts.entries()].flatMap(([recipientId, draft]) => {
    if (draft.ownLines.length === 0 && draft.teamLines.length === 0) {
      return [];
    }
    const sections: string[] = ["💰 **Bryan Bucks — game settled**"];
    if (draft.ownLines.length > 0) {
      sections.push(["**Your bets**", ...draft.ownLines].join("\n"));
    }
    if (draft.teamLines.length > 0) {
      sections.push(["**Bets on your team**", ...draft.teamLines].join("\n"));
    }
    return [
      {
        recipientId,
        kind:
          draft.ownLines.length > 0
            ? "betting_settlement_receipt"
            : "betting_player_bet_outcome",
        content: truncateDiscordMessage(
          sections.join("\n\n"),
          MAX_SETTLEMENT_DM_LENGTH - TRUNCATION_SUFFIX.length,
        ),
      },
    ];
  });
}
