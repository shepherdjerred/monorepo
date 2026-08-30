import { EmbedBuilder } from "discord.js";
import {
  RiotTeamIdSchema,
  type RiotTeamId,
  formatInteger,
} from "@scout-for-lol/data";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPosition } from "#src/betting/sweep-types.ts";
import { outcomeLabel, type OutcomeFraming } from "#src/betting/team.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";

const MAX_SETTLEMENT_DM_LENGTH = 1900;
const MAX_EMBED_FIELD_LENGTH = 1024;
const MAX_EMBED_DESCRIPTION_LENGTH = 2048;
const TRUNCATION_SUFFIX = "...";
export const SETTLEMENT_DM_NOTIFICATION_HINT =
  "You can manage these DMs with `/bb notifications`.";

const BUCKS_COLOR = 0x2e_cc_71;

export type SettlementDmKind =
  "betting_settlement_receipt" | "betting_player_bet_outcome";

/**
 * What the settled game looked like, for the DM's header. Every field is
 * prepared prose: the builder stays pure and the delivery layer owns queue
 * labels, champion names, and prediction phrasing. All optional — the stale
 * void path has no match payload and legacy pools may lack a queue.
 */
export type SettlementDmMatchContext = {
  /** e.g. "Ranked solo — jerred (Ahri), bryan (Lee Sin)". */
  gameLine?: string | undefined;
  /** e.g. "jerred's team won." or "Voided — remake." */
  resultLine?: string | undefined;
  /** Scout's revealed estimate + verdict, when displayable. */
  predictionLine?: string | undefined;
};

export type SettlementDmMessage = {
  recipientId: string;
  kind: SettlementDmKind;
  /** Plain-text rendering for the audit log and clients without embeds. */
  content: string;
  embed: EmbedBuilder;
  showHint: boolean;
};

export type TeamRecipient = {
  discordId: string;
  teamId: RiotTeamId;
};

/** One recipient's own earnings from this game, already labelled. */
export type RecipientEarningLine = {
  discordId: string;
  line: string;
};

type OutcomePosition = {
  bettorId: string;
  teamId: RiotTeamId;
  subjectAlias: string | undefined;
  submittedStake: number;
  matchedStake: number;
  unmatchedStake: number;
  outcome: "won" | "lost" | "refunded" | "unmatched";
  winnings: number;
};

type RecipientDraft = {
  ownLines: string[];
  teamLines: string[];
  earningLines: string[];
};

function outcomePositions(input: {
  summary: SettlementSummary;
  includeOutcome: boolean;
  unmatchedPositions: readonly ClosedPosition[];
  subjectAliasByPuuid: ReadonlyMap<string, string> | undefined;
}): OutcomePosition[] {
  if (!input.includeOutcome) {
    return [];
  }
  const settled = input.summary.bets
    .filter((bet) => !bet.isHouse)
    .map((bet): OutcomePosition => ({
      bettorId: bet.discordId,
      teamId: RiotTeamIdSchema.parse(bet.predictedTeamId),
      subjectAlias: input.subjectAliasByPuuid?.get(bet.subjectPuuid),
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
      subjectAlias: undefined,
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
    ? ` ${formatInteger(position.unmatchedStake)} BB was unmatched and returned.`
    : "";
}

function sideLabel(
  position: OutcomePosition,
  framing: OutcomeFraming | undefined,
): string {
  const side = outcomeLabel(position.teamId, framing);
  // "WIN on jerred" answers "who did I bet on" without a lookup; an unmatched
  // or roster-less position degrades to the bare side.
  return position.subjectAlias === undefined
    ? side
    : `${side} on ${position.subjectAlias}`;
}

function ownOutcomeLine(
  position: OutcomePosition,
  framing: OutcomeFraming | undefined,
): string {
  const side = sideLabel(position, framing);
  if (position.outcome === "unmatched") {
    return `• ${side} — ${formatInteger(position.submittedStake)} BB was unmatched and refunded.`;
  }
  if (position.outcome === "refunded") {
    return `• ${side} — ${formatInteger(position.matchedStake)} BB matched and refunded.${returnedSuffix(position)}`;
  }
  if (position.outcome === "won") {
    return `• ${side} — ${formatInteger(position.submittedStake)} BB → won **${formatInteger(position.winnings)} BB**.${returnedSuffix(position)}`;
  }
  return `• ${side} — ${formatInteger(position.submittedStake)} BB → lost ${formatInteger(position.matchedStake)} BB.${returnedSuffix(position)}`;
}

function teamOutcomeLine(
  position: OutcomePosition,
  recipientTeamId: RiotTeamId,
): string {
  const direction = position.teamId === recipientTeamId ? "for" : "against";
  const bettor = `<@${position.bettorId}>`;
  if (position.outcome === "unmatched") {
    return `• ${bettor} bet ${direction} your team, but ${formatInteger(position.submittedStake)} BB was unmatched and refunded.`;
  }
  if (position.outcome === "refunded") {
    return `• ${bettor} bet ${direction} your team and received a ${formatInteger(position.matchedStake)} BB refund.${returnedSuffix(position)}`;
  }
  if (position.outcome === "won") {
    return `• ${bettor} bet ${direction} your team and won ${formatInteger(position.winnings)} BB.${returnedSuffix(position)}`;
  }
  return `• ${bettor} bet ${direction} your team and lost ${formatInteger(position.matchedStake)} BB.${returnedSuffix(position)}`;
}

function ownParlayLine(bet: ParlaySettlementSummary["bets"][number]): string {
  if (bet.outcome === "won") {
    return `• Parlay ${bet.side} — ${formatInteger(bet.stake)} BB → won **${formatInteger(bet.payout - bet.stake)} BB**.`;
  }
  if (bet.outcome === "refunded") {
    return `• Parlay ${bet.side} — ${formatInteger(bet.stake)} BB was refunded.`;
  }
  return `• Parlay ${bet.side} — ${formatInteger(bet.stake)} BB → lost ${formatInteger(bet.stake)} BB.`;
}

function draftFor(
  drafts: Map<string, RecipientDraft>,
  recipientId: string,
): RecipientDraft {
  const existing = drafts.get(recipientId);
  if (existing !== undefined) {
    return existing;
  }
  const created: RecipientDraft = {
    ownLines: [],
    teamLines: [],
    earningLines: [],
  };
  drafts.set(recipientId, created);
  return created;
}

function boundedField(lines: readonly string[]): string {
  return truncateDiscordMessage(
    lines.join("\n"),
    MAX_EMBED_FIELD_LENGTH - TRUNCATION_SUFFIX.length,
  );
}

function buildEmbed(
  draft: RecipientDraft,
  matchContext: SettlementDmMatchContext | undefined,
): EmbedBuilder {
  const descriptionLines = [
    matchContext?.gameLine,
    matchContext?.resultLine,
    matchContext?.predictionLine,
  ].flatMap((line) => (line === undefined || line === "" ? [] : [line]));
  const embed = new EmbedBuilder()
    .setTitle("💰 Bryan Bucks — game settled")
    .setColor(BUCKS_COLOR);
  if (descriptionLines.length > 0) {
    embed.setDescription(
      truncateDiscordMessage(
        descriptionLines.join("\n"),
        MAX_EMBED_DESCRIPTION_LENGTH,
      ),
    );
  }
  if (draft.ownLines.length > 0) {
    embed.addFields({
      name: "Your bets",
      value: boundedField(draft.ownLines),
    });
  }
  if (draft.teamLines.length > 0) {
    embed.addFields({
      name: "Bets on your team",
      value: boundedField(draft.teamLines),
    });
  }
  if (draft.earningLines.length > 0) {
    embed.addFields({
      name: "Bucks you earned",
      value: boundedField(draft.earningLines),
    });
  }
  return embed;
}

/** Build one bounded, private result message per recipient and settled match. */
export function buildSettlementDmMessages(input: {
  summary: SettlementSummary;
  includeOutcome: boolean;
  parlay: ParlaySettlementSummary | undefined;
  unmatchedPositions: readonly ClosedPosition[];
  framing: OutcomeFraming | undefined;
  receiptsEnabled: boolean;
  receiptRecipientIds?: ReadonlySet<string>;
  playerBetOutcomesEnabled: boolean;
  playerRecipients: readonly TeamRecipient[];
  hintRecipientIds?: ReadonlySet<string>;
  matchContext?: SettlementDmMatchContext;
  /** Frozen roster aliases, so "WIN on jerred" needs no lookup at render. */
  subjectAliasByPuuid?: ReadonlyMap<string, string>;
  /** This game's earnings, shown only to the member who earned them. */
  earningLines?: readonly RecipientEarningLine[];
}): SettlementDmMessage[] {
  const drafts = new Map<string, RecipientDraft>();
  const outcomes = outcomePositions({
    summary: input.summary,
    includeOutcome: input.includeOutcome,
    unmatchedPositions: input.unmatchedPositions,
    subjectAliasByPuuid: input.subjectAliasByPuuid,
  });

  if (input.receiptsEnabled) {
    for (const position of outcomes) {
      if (
        input.receiptRecipientIds !== undefined &&
        !input.receiptRecipientIds.has(position.bettorId)
      ) {
        continue;
      }
      draftFor(drafts, position.bettorId).ownLines.push(
        ownOutcomeLine(position, input.framing),
      );
    }
    for (const bet of input.parlay?.bets ?? []) {
      if (
        input.receiptRecipientIds !== undefined &&
        !input.receiptRecipientIds.has(bet.discordId)
      ) {
        continue;
      }
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

  // Earnings enrich an existing DM; they never create one on their own —
  // members with no bet and no team involvement already see them in the
  // channel recap.
  for (const earning of input.earningLines ?? []) {
    const draft = drafts.get(earning.discordId);
    if (draft !== undefined) {
      draft.earningLines.push(earning.line);
    }
  }

  return [...drafts.entries()].flatMap(([recipientId, draft]) => {
    if (draft.ownLines.length === 0 && draft.teamLines.length === 0) {
      return [];
    }
    const contextLines = [
      input.matchContext?.gameLine,
      input.matchContext?.resultLine,
      input.matchContext?.predictionLine,
    ].flatMap((line) => (line === undefined || line === "" ? [] : [line]));
    const sections: string[] = ["💰 **Bryan Bucks — game settled**"];
    if (contextLines.length > 0) {
      sections.push(contextLines.join("\n"));
    }
    if (draft.ownLines.length > 0) {
      sections.push(["**Your bets**", ...draft.ownLines].join("\n"));
    }
    if (draft.teamLines.length > 0) {
      sections.push(["**Bets on your team**", ...draft.teamLines].join("\n"));
    }
    if (draft.earningLines.length > 0) {
      sections.push(["**Bucks you earned**", ...draft.earningLines].join("\n"));
    }
    const showHint = input.hintRecipientIds?.has(recipientId) === true;
    const hint = showHint ? `\n\n${SETTLEMENT_DM_NOTIFICATION_HINT}` : "";
    const maxSettlementContentLength =
      MAX_SETTLEMENT_DM_LENGTH - TRUNCATION_SUFFIX.length - hint.length;
    return [
      {
        recipientId,
        kind:
          draft.ownLines.length > 0
            ? "betting_settlement_receipt"
            : "betting_player_bet_outcome",
        content: `${truncateDiscordMessage(
          sections.join("\n\n"),
          maxSettlementContentLength,
        )}${hint}`,
        embed: buildEmbed(draft, input.matchContext),
        showHint,
      },
    ];
  });
}
