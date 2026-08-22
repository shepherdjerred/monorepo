import { EmbedBuilder, type MessageCreateOptions } from "discord.js";
import {
  RiotTeamIdSchema,
  type BucksPrediction,
  type BucksVoidReason,
} from "@scout-for-lol/data";
import type { EarnedAward } from "#src/betting/earnings.ts";
import { shouldDisplayPrediction } from "#src/betting/prediction.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import type { SettlementBet, SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPosition } from "#src/betting/sweep.ts";
import { outcomeLabel, type OutcomeFraming } from "#src/betting/team.ts";

/** Beyond this the message stops being readable, so the tail is summarised. */
const MAX_BET_ROWS = 15;
const MAX_EARNING_ALIAS_LENGTH = 100;
const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_TOTAL_TEXT_LIMIT = 6000;
const COIN_FLIP = 0.5;

export type SettlementMessageInput = {
  summary: SettlementSummary;
  /**
   * False when this pool was not settled by this pass and the embed exists
   * only to carry a parlay result — the "parlay settled but its pool voided or
   * settled on an earlier tick" case.
   */
  includeOutcome: boolean;
  parlay: ParlaySettlementSummary | undefined;
  framing: OutcomeFraming | undefined;
  earnings: readonly EarnedAward[];
  unmatchedPositions?: readonly ClosedPosition[];
  predictionSentence: string | undefined;
  predictionVerdictLine: string | undefined;
};

type SettlementDisplay = {
  summaryLines: string[];
  betLines: string[];
  parlayLegLines: string[];
  parlayPositionLines: string[];
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

/**
 * The gross/cut/net arithmetic is preserved verbatim: public outcome copy must
 * never make a reader reconstruct it from ledger rows.
 */
function settlementBetResult(bet: SettlementBet): string {
  if (bet.refunded) {
    return `refunded **${bet.payout.toString()} BB**`;
  }
  if (bet.won) {
    return `+**${bet.winnings.toString()} BB** (${bet.grossPayout.toString()} − ${bet.houseCut.toString()} fee = ${bet.payout.toString()} back)`;
  }
  return `−**${bet.matchedStake.toString()} BB**`;
}

function settlementBetLines(input: SettlementMessageInput): string[] {
  const humanBets = input.summary.bets.filter((bet) => !bet.isHouse);
  const unmatchedPositions = input.unmatchedPositions ?? [];
  const visibleHumanBets = humanBets.slice(0, MAX_BET_ROWS);
  const lines = visibleHumanBets.map((bet) => {
    const refunded =
      bet.unmatchedStake > 0
        ? `, refunded **${bet.unmatchedStake.toString()}**`
        : "";
    return `• <@${bet.discordId}> ${outcomeLabel(RiotTeamIdSchema.parse(bet.predictedTeamId), input.framing)} ${bet.submittedStake.toString()} → matched **${bet.matchedStake.toString()}**${refunded} · ${settlementBetResult(bet)}`;
  });
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
      `• <@${position.discordId}> ${outcomeLabel(position.teamId, input.framing)} ${position.submittedStake.toString()} → nothing matched, refunded **${position.unmatchedStake.toString()}**`,
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

/** Prose for a parlay void; the raw enum must never reach a player. */
function parlayVoidText(reason: string): string {
  switch (reason) {
    case "remake":
      return "remake";
    case "expired":
      return "the game never resolved";
    case "unsupported_mode":
      return "unsupported game mode";
    case "missing_data":
      return "missing match data";
    case "unknown_evaluator":
      return "a settlement rule changed";
    case "invalid_definition":
      return "an invalid parlay definition";
    case "storage_overflow":
      return "a result outside Bryan Bucks storage limits";
    default:
      return "an unresolved market";
  }
}

function parlayLegLines(parlay: ParlaySettlementSummary | undefined): string[] {
  if (parlay === undefined) {
    return [];
  }
  if (parlay.voidReason !== undefined) {
    return [
      `Every stake and house reserve was returned (${parlayVoidText(parlay.voidReason)}).`,
    ];
  }
  return parlay.legs.map(
    (leg) =>
      `${leg.passed ? "✅" : "❌"} ${leg.rendered} — ${String(leg.actualValue)}`,
  );
}

function parlayPositionLines(
  parlay: ParlaySettlementSummary | undefined,
): string[] {
  if (parlay === undefined) {
    return [];
  }
  const lines = parlay.bets
    .slice(0, MAX_BET_ROWS)
    .map(
      (bet) =>
        `• <@${bet.discordId}> ${bet.side} ${bet.stake.toString()} → ${bet.outcome}, **${bet.payout.toString()} BB**`,
    );
  const hidden = parlay.bets.length - MAX_BET_ROWS;
  if (hidden > 0) {
    lines.push(`…and ${hidden.toString()} more — see \`/bb history\``);
  }
  return lines;
}

/** `Parlay — NO (1/2 legs)`, or the void headline. */
export function parlayFieldTitle(parlay: ParlaySettlementSummary): string {
  if (parlay.voidReason !== undefined) {
    return `Parlay — voided (${parlayVoidText(parlay.voidReason)})`;
  }
  const passed = parlay.legs.filter((leg) => leg.passed).length;
  return `Parlay — ${parlay.yesResult === true ? "YES" : "NO"} (${passed.toString()}/${parlay.legs.length.toString()} legs)`;
}

function formatSettlementDisplay(
  input: SettlementMessageInput,
): SettlementDisplay {
  return {
    summaryLines: input.includeOutcome ? settlementSummaryLines(input) : [],
    betLines: input.includeOutcome ? settlementBetLines(input) : [],
    parlayLegLines: parlayLegLines(input.parlay),
    parlayPositionLines: parlayPositionLines(input.parlay),
    earningLines: settlementEarningLines(input),
  };
}

/** Score the stored prediction against the result, or return nothing. */
export function predictionVerdict(
  prediction: BucksPrediction | undefined,
  winningTeamId: number | undefined,
): string | undefined {
  if (winningTeamId === undefined || prediction === undefined) {
    return undefined;
  }
  if ("version" in prediction) {
    if (!shouldDisplayPrediction(prediction.blueWinProbability)) {
      return undefined;
    }
    const predictedBlueWin = prediction.blueWinProbability > COIN_FLIP;
    const blueWon = winningTeamId === 100;
    return predictedBlueWin === blueWon
      ? "Scout called it."
      : "Scout was wrong.";
  }
  if (!shouldDisplayPrediction(prediction.winProbability)) {
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

type EmbedSection = {
  title: string;
  lines: string[];
  overflow: (hidden: number) => string;
};

function renderEmbed(
  description: string,
  sections: readonly EmbedSection[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("💰 Bryan Bucks")
    .setDescription(description);
  for (const section of sections) {
    addEmbedSection(embed, section.title, section.lines);
  }
  return embed;
}

/**
 * Fit the sections into Discord's embed budget by trimming, not by throwing.
 *
 * Merging the parlay result into this embed made the 6000-character ceiling
 * genuinely reachable — the parlay suite's own worst-case fixture already
 * needed chunking before outcome rows and earnings were added. Throwing here
 * would discard a settlement permanently, because the pool has committed as
 * settled and a later pass returns no summary for it.
 *
 * Sections are trimmed in the order given (earliest first), each replacing its
 * dropped tail with an overflow note. The description carries the outcome
 * summary and the parlay verdict and is never trimmed; if it alone exceeds the
 * budget that is a broken caller and still fails loudly.
 */
function fitSections(
  description: string,
  sections: readonly EmbedSection[],
): EmbedBuilder {
  const working = sections.map((section) => ({
    ...section,
    lines: [...section.lines],
    hidden: 0,
  }));
  for (;;) {
    const embed = renderEmbed(
      description,
      working.map((section) => ({
        ...section,
        lines:
          section.hidden > 0
            ? [...section.lines, section.overflow(section.hidden)]
            : section.lines,
      })),
    );
    if (embedTextLength(embed) <= EMBED_TOTAL_TEXT_LIMIT) {
      return embed;
    }
    const trimmable = working.find((section) => section.lines.length > 0);
    if (trimmable === undefined) {
      throw new Error("A Bryan Bucks outcome exceeds Discord's embed limit");
    }
    trimmable.lines.pop();
    trimmable.hidden += 1;
  }
}

/** Build the one Discord message that carries a complete bounded outcome. */
export function buildSettlementMessage(
  input: SettlementMessageInput,
): MessageCreateOptions {
  const display = formatSettlementDisplay(input);
  const descriptionLines = [...display.summaryLines];
  if (input.parlay !== undefined && !input.includeOutcome) {
    descriptionLines.push(parlayFieldTitle(input.parlay));
  }
  // Drop-first order: earnings are the least load-bearing, the outcome bet
  // rows the most.
  const allSections: EmbedSection[] = [
    {
      title: "Bucks earned",
      lines: display.earningLines,
      overflow: (hidden) => `…and ${hidden.toString()} more.`,
    },
    {
      title:
        input.parlay === undefined ? "Parlay" : parlayFieldTitle(input.parlay),
      lines: display.parlayLegLines,
      overflow: (hidden) => `…and ${hidden.toString()} more legs.`,
    },
    {
      title: "Parlay positions",
      lines: display.parlayPositionLines,
      overflow: (hidden) =>
        `…and ${hidden.toString()} more — see \`/bb history\``,
    },
    {
      title: "Bets",
      lines: display.betLines,
      overflow: (hidden) =>
        `…and ${hidden.toString()} more — see \`/bb history\``,
    },
  ];
  const sections = allSections.filter((section) => section.lines.length > 0);

  return {
    embeds: [fitSections(descriptionLines.join("\n"), sections)],
    allowedMentions: { parse: [] },
  };
}
