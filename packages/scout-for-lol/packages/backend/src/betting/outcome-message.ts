import { EmbedBuilder, type MessageCreateOptions } from "discord.js";
import type { BucksPrediction, BucksVoidReason } from "@scout-for-lol/data";
import type { EarnedAward } from "#src/betting/earnings.ts";
import { shouldDisplayPrediction } from "#src/betting/prediction.ts";
import type { SettlementBet, SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPosition } from "#src/betting/sweep.ts";

/** Beyond this the message stops being readable, so the tail is summarised. */
const MAX_BET_ROWS = 15;
const MAX_EARNING_ALIAS_LENGTH = 100;
const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_TOTAL_TEXT_LIMIT = 6000;
const COIN_FLIP = 0.5;

type SettlementMessageInput = {
  summary: SettlementSummary;
  earnings: readonly EarnedAward[];
  unmatchedPositions?: readonly ClosedPosition[];
  predictionSentence: string | undefined;
  predictionVerdictLine: string | undefined;
};

type SettlementDisplay = {
  summaryLines: string[];
  betLines: string[];
  earningLines: string[];
};

function voidReasonText(reason: BucksVoidReason): string {
  switch (reason) {
    case "remake":
      return "Remake — every matched stake refunded.";
    case "no_counterparty":
      return "No takers on the other side — every matched stake refunded.";
    case "house_unavailable":
      return "The Bryan Bucks house reserve was unavailable — every matched stake refunded.";
    case "expired":
      return "This game never resolved — every matched stake refunded.";
    case "storage_overflow":
      return "The result exceeded Bryan Bucks storage limits — every matched stake refunded.";
    case "unsupported_mode":
      return "Unsupported game mode — every matched stake refunded.";
  }
}

function settlementSummaryLines(input: SettlementMessageInput): string[] {
  const { summary } = input;
  const pool = summary.bets.reduce((total, bet) => total + bet.matchedStake, 0);
  let outcome: string;
  if (
    (input.unmatchedPositions?.length ?? 0) > 0 &&
    summary.bets.length === 0
  ) {
    outcome =
      "Matched pool **0 BB** · winner fees **0 BB**. No stake was matched; every offer was refunded.";
  } else if (summary.voidReason === undefined) {
    outcome = `Matched pool **${pool.toString()} BB** · winner fees **${summary.houseCut.toString()} BB** (winners matched ${summary.winnersPool.toString()} / losers matched ${summary.losersPool.toString()})`;
  } else {
    outcome = `Matched pool **${pool.toString()} BB** · winner fees **0 BB**. ${voidReasonText(summary.voidReason)}`;
  }

  const lines = [outcome];
  if (input.predictionSentence !== undefined) {
    const verdict =
      input.predictionVerdictLine === undefined
        ? ""
        : ` ${input.predictionVerdictLine}`;
    lines.push(`${input.predictionSentence}${verdict}`);
  }
  const houseStake = summary.bets
    .filter((bet) => bet.isHouse)
    .reduce((total, bet) => total + bet.matchedStake, 0);
  if (houseStake > 0) {
    lines.push(
      `🏦 Bryan Bucks house matched ${houseStake.toString()} BB on the other side.`,
    );
  }
  return lines;
}

function settlementBetResult(bet: SettlementBet): string {
  if (bet.refunded) {
    return `matched stake refunded ${bet.payout.toString()} BB (no winner fee)`;
  }
  if (bet.won) {
    return `gross ${bet.grossPayout.toString()} BB − ${bet.houseCut.toString()} BB winner fee = ${bet.payout.toString()} BB received (+${bet.winnings.toString()} BB net winnings)`;
  }
  return `lost ${bet.matchedStake.toString()} BB`;
}

function settlementBetLines(input: SettlementMessageInput): string[] {
  const humanBets = input.summary.bets.filter((bet) => !bet.isHouse);
  const unmatchedPositions = input.unmatchedPositions ?? [];
  const visibleHumanBets = humanBets.slice(0, MAX_BET_ROWS);
  const lines = visibleHumanBets.map(
    (bet) =>
      `• <@${bet.discordId}> offered ${bet.submittedStake.toString()} BB · matched ${bet.matchedStake.toString()} BB · refunded ${bet.unmatchedStake.toString()} BB → ${settlementBetResult(bet)}`,
  );
  const unmatchedLimit = MAX_BET_ROWS - visibleHumanBets.length;
  for (const position of unmatchedPositions.slice(0, unmatchedLimit)) {
    if (
      position.matchedStake !== 0 ||
      position.unmatchedStake !== position.submittedStake
    ) {
      throw new Error(
        `Outcome receipt received non-terminal unmatched bet ${position.betId.toString()}`,
      );
    }
    lines.push(
      `• <@${position.discordId}> offered ${position.submittedStake.toString()} BB · matched 0 BB · refunded ${position.unmatchedStake.toString()} BB → no stake was matched`,
    );
  }
  const hiddenCount =
    humanBets.length + unmatchedPositions.length - MAX_BET_ROWS;
  if (hiddenCount > 0) {
    lines.push(`…and ${hiddenCount.toString()} more — see \`/bb history\``);
  }
  return lines;
}

function formatEarningAlias(alias: string): string {
  if (alias.length <= MAX_EARNING_ALIAS_LENGTH) {
    return alias;
  }
  return `${alias.slice(0, MAX_EARNING_ALIAS_LENGTH - 1)}…`;
}

function settlementEarningLines(input: SettlementMessageInput): string[] {
  return input.earnings
    .filter((award) => award.serverId === input.summary.serverId)
    .map(
      (award) =>
        `🪙 **${formatEarningAlias(award.alias)}** +${award.total.toString()} BB (${award.reasons.join(", ")})`,
    );
}

function formatSettlementDisplay(
  input: SettlementMessageInput,
): SettlementDisplay {
  return {
    summaryLines: settlementSummaryLines(input),
    betLines: settlementBetLines(input),
    earningLines: settlementEarningLines(input),
  };
}

/** Score the stored prediction against the result, or return nothing. */
export function predictionVerdict(
  prediction: BucksPrediction | undefined,
  winningTeamId: number | undefined,
): string | undefined {
  if (
    winningTeamId === undefined ||
    prediction === undefined ||
    !shouldDisplayPrediction(prediction.winProbability)
  ) {
    return undefined;
  }
  const predictedWin = prediction.winProbability > COIN_FLIP;
  const subjectWon = prediction.subjectTeamId === winningTeamId;
  return predictedWin === subjectWon ? "Scout called it." : "Scout was wrong.";
}

export function formatSettlementBody(input: SettlementMessageInput): string {
  const display = formatSettlementDisplay(input);
  const blocks = [display.summaryLines.join("\n")];
  if (display.betLines.length > 0) {
    blocks.push(["**Bets**", ...display.betLines].join("\n"));
  }
  if (display.earningLines.length > 0) {
    blocks.push(display.earningLines.join("\n"));
  }
  return blocks.join("\n\n");
}

function splitEmbedFieldValues(lines: readonly string[]): string[] {
  const values: string[] = [];
  let current = "";
  for (const line of lines) {
    if (line.length > EMBED_FIELD_VALUE_LIMIT) {
      throw new Error(
        "A Bryan Bucks outcome row exceeds Discord's field limit",
      );
    }
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length <= EMBED_FIELD_VALUE_LIMIT) {
      current = candidate;
      continue;
    }
    values.push(current);
    current = line;
  }
  if (current.length > 0) {
    values.push(current);
  }
  return values;
}

function addEmbedSection(
  embed: EmbedBuilder,
  title: string,
  lines: readonly string[],
): void {
  for (const [index, value] of splitEmbedFieldValues(lines).entries()) {
    embed.addFields({
      name: index === 0 ? title : `${title} (continued)`,
      value,
    });
  }
}

function embedTextLength(embed: EmbedBuilder): number {
  const json = embed.toJSON();
  return (
    (json.title?.length ?? 0) +
    (json.description?.length ?? 0) +
    (json.footer?.text.length ?? 0) +
    (json.author?.name.length ?? 0) +
    (json.fields ?? []).reduce(
      (total, field) => total + field.name.length + field.value.length,
      0,
    )
  );
}

/** Build the one Discord message that carries a complete bounded outcome. */
export function buildSettlementMessage(
  input: SettlementMessageInput,
): MessageCreateOptions {
  const display = formatSettlementDisplay(input);
  const embed = new EmbedBuilder()
    .setTitle("💰 Bryan Bucks outcomes")
    .setDescription(display.summaryLines.join("\n"));
  addEmbedSection(embed, "Bets", display.betLines);
  addEmbedSection(embed, "Bucks earned", display.earningLines);
  if (embedTextLength(embed) > EMBED_TOTAL_TEXT_LIMIT) {
    throw new Error("A Bryan Bucks outcome exceeds Discord's embed limit");
  }
  return {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}
