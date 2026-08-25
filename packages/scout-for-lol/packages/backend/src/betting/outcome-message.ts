import { EmbedBuilder, type MessageCreateOptions } from "discord.js";
import {
  type BucksPrediction,
  type BucksVoidReason,
} from "@scout-for-lol/data";
import type { EarnedAward } from "#src/betting/earnings.ts";
import { shouldDisplayPrediction } from "#src/betting/prediction.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { SettlementBet } from "#src/betting/settlement-types.ts";
import type { ClosedPosition } from "#src/betting/sweep-types.ts";
import type { OutcomeFraming } from "#src/betting/team.ts";
import {
  formatInteger,
  formatParlayNumericValue,
} from "#src/betting/display-format.ts";

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
  betWinnerLines: string[];
  betLoserLines: string[];
  parlayLegLines: string[];
  parlayWinnerLines: string[];
  parlayLoserLines: string[];
  earningLines: string[];
};

function voidReasonText(reason: BucksVoidReason): string {
  switch (reason) {
    case "remake":
      return "remake";
    case "no_counterparty":
      return "no takers on the other side";
    case "house_unavailable":
      return "house reserve unavailable";
    case "expired":
      return "game never resolved";
    case "storage_overflow":
      return "result exceeded storage limits";
    case "unsupported_mode":
      return "unsupported game mode";
  }
}

function outcomeRefundSummary(
  input: SettlementMessageInput,
): string | undefined {
  const refundedAmounts = input.summary.bets
    .filter((bet) => !bet.isHouse)
    .map((bet) => bet.unmatchedStake + (bet.refunded ? bet.matchedStake : 0));
  for (const position of input.unmatchedPositions ?? []) {
    if (
      position.matchedStake !== 0 ||
      position.unmatchedStake !== position.submittedStake
    ) {
      throw new Error(
        `Outcome receipt received non-terminal unmatched bet ${position.betId.toString()}`,
      );
    }
    refundedAmounts.push(position.unmatchedStake);
  }
  const refunded = refundedAmounts.reduce((total, amount) => total + amount, 0);
  const count = refundedAmounts.filter((amount) => amount > 0).length;
  if (refunded === 0) return;
  const reason =
    input.summary.voidReason === undefined
      ? ""
      : ` (${voidReasonText(input.summary.voidReason)})`;
  return `BET REFUNDS: **${formatInteger(refunded)}BB** across ${formatInteger(count)} bet${count === 1 ? "" : "s"}${reason}.`;
}

function parlayRefundSummary(
  parlay: ParlaySettlementSummary | undefined,
): string | undefined {
  if (parlay === undefined) return;
  const refundedBets = parlay.bets.filter((bet) => bet.outcome === "refunded");
  const refunded = refundedBets.reduce((total, bet) => total + bet.stake, 0);
  if (refunded === 0) return;
  const reason =
    parlay.voidReason === undefined
      ? ""
      : ` (${parlayVoidText(parlay.voidReason)})`;
  return `PARLAY REFUNDS: **${formatInteger(refunded)}BB** across ${formatInteger(refundedBets.length)} parlay${refundedBets.length === 1 ? "" : "s"}${reason}.`;
}

function settlementSummaryLines(input: SettlementMessageInput): string[] {
  const lines: string[] = [];
  if (input.predictionSentence !== undefined) {
    const verdict =
      input.predictionVerdictLine === undefined
        ? ""
        : ` ${input.predictionVerdictLine}`;
    lines.push(`${input.predictionSentence}${verdict}`);
  }
  const betRefund = input.includeOutcome
    ? outcomeRefundSummary(input)
    : undefined;
  if (betRefund !== undefined) lines.push(betRefund);
  const parlayRefund = parlayRefundSummary(input.parlay);
  if (parlayRefund !== undefined) lines.push(parlayRefund);
  return lines;
}

function settlementBetLine(bet: SettlementBet): string {
  if (bet.refunded) {
    throw new Error("Refunded bets do not belong in result sections");
  }
  if (!bet.won) {
    return `• <@${bet.discordId}> bet ${formatInteger(bet.submittedStake)}BB, lost ${formatInteger(bet.matchedStake)}BB`;
  }
  const fee =
    bet.houseCut === 0 ? "" : ` (${formatInteger(bet.houseCut)}BB fee)`;
  return `• <@${bet.discordId}> bet ${formatInteger(bet.submittedStake)}BB, won ${formatInteger(bet.winnings)}BB${fee}`;
}

function settlementBetLines(input: SettlementMessageInput): {
  winners: string[];
  losers: string[];
} {
  const humanBets = input.summary.bets.filter(
    (bet) => !bet.isHouse && !bet.refunded,
  );
  const visible = humanBets.slice(0, MAX_BET_ROWS);
  const winners = visible
    .filter((bet) => bet.won)
    .map((bet) => settlementBetLine(bet));
  const losers = visible
    .filter((bet) => !bet.won)
    .map((bet) => settlementBetLine(bet));
  const hiddenCount = humanBets.length - MAX_BET_ROWS;
  if (hiddenCount > 0) {
    const destination = losers.length > 0 ? losers : winners;
    destination.push(
      `…and ${formatInteger(hiddenCount)} more — see \`/bb history\``,
    );
  }
  return { winners, losers };
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
        `🪙 **${formatEarningAlias(award.alias)}** +${formatInteger(award.total)} BB (${award.reasons.join(", ")})`,
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
    return [`Voided — ${parlayVoidText(parlay.voidReason)}.`];
  }
  return parlay.legs.map((leg) => {
    let actual: string;
    if (typeof leg.actualValue === "boolean") {
      actual = String(leg.actualValue);
    } else {
      switch (leg.condition.kind) {
        case "participant_numeric":
        case "match_numeric":
        case "opponent_team_pings":
          actual = formatParlayNumericValue(
            leg.condition.field,
            leg.actualValue,
          );
          break;
        case "team_objective_kills":
          actual = formatInteger(leg.actualValue);
          break;
        case "participant_boolean":
        case "team_boolean":
        case "team_objective_first":
          throw new Error("Boolean parlay leg carried a numeric result");
      }
    }
    return `${leg.passed ? "✅" : "❌"} ${leg.rendered} — ${actual}`;
  });
}

function parlayPositionLines(parlay: ParlaySettlementSummary | undefined): {
  winners: string[];
  losers: string[];
} {
  if (parlay === undefined) {
    return { winners: [], losers: [] };
  }
  const settled = parlay.bets.filter((bet) => bet.outcome !== "refunded");
  const visible = settled.slice(0, MAX_BET_ROWS).map((bet) => ({
    outcome: bet.outcome,
    line:
      bet.outcome === "won"
        ? `• <@${bet.discordId}> bet ${formatInteger(bet.stake)}BB, won ${formatInteger(bet.grossPayout - bet.stake)}BB`
        : `• <@${bet.discordId}> bet ${formatInteger(bet.stake)}BB, lost ${formatInteger(bet.stake)}BB`,
  }));
  const winners = visible
    .filter((row) => row.outcome === "won")
    .map((row) => row.line);
  const losers = visible
    .filter((row) => row.outcome === "lost")
    .map((row) => row.line);
  const hidden = settled.length - MAX_BET_ROWS;
  if (hidden > 0) {
    const destination = losers.length > 0 ? losers : winners;
    destination.push(
      `…and ${formatInteger(hidden)} more — see \`/bb history\``,
    );
  }
  return { winners, losers };
}

/** `Parlay — NO (1/2 legs)`, or the void headline. */
export function parlayFieldTitle(parlay: ParlaySettlementSummary): string {
  if (parlay.voidReason !== undefined) {
    return `Parlay — voided (${parlayVoidText(parlay.voidReason)})`;
  }
  const passed = parlay.legs.filter((leg) => leg.passed).length;
  return `Parlay — ${parlay.yesResult === true ? "YES" : "NO"} (${formatInteger(passed)}/${formatInteger(parlay.legs.length)} legs)`;
}

function formatSettlementDisplay(
  input: SettlementMessageInput,
): SettlementDisplay {
  const bets = settlementBetLines(input);
  const parlays = parlayPositionLines(input.parlay);
  return {
    summaryLines: settlementSummaryLines(input),
    betWinnerLines: input.includeOutcome ? bets.winners : [],
    betLoserLines: input.includeOutcome ? bets.losers : [],
    parlayLegLines: parlayLegLines(input.parlay),
    parlayWinnerLines: parlays.winners,
    parlayLoserLines: parlays.losers,
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
  const blocks = [display.summaryLines.join("\n")].filter(
    (block) => block.length > 0,
  );
  for (const [title, lines] of [
    ["BET WINNERS", display.betWinnerLines],
    ["BET LOSERS", display.betLoserLines],
    [
      input.parlay === undefined ? "PARLAY" : parlayFieldTitle(input.parlay),
      display.parlayLegLines,
    ],
    ["PARLAY WINNERS", display.parlayWinnerLines],
    ["PARLAY LOSERS", display.parlayLoserLines],
  ] satisfies readonly (readonly [string, readonly string[]])[]) {
    if (lines.length > 0) blocks.push([`**${title}:**`, ...lines].join("\n"));
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
  trimPriority: number;
};

function renderEmbed(
  description: string,
  sections: readonly EmbedSection[],
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle("💰 Bryan Bucks");
  if (description.length > 0) embed.setDescription(description);
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
    const trimmable = working
      .toSorted((left, right) => left.trimPriority - right.trimPriority)
      .find((section) => section.lines.length > 0);
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
  // Earnings trim first, followed by leg detail and parlay rows. Outcome result
  // rows remain the last content removed from an oversized embed.
  const allSections: EmbedSection[] = [
    {
      title: "BET WINNERS",
      lines: display.betWinnerLines,
      overflow: (hidden) =>
        `…and ${formatInteger(hidden)} more — see \`/bb history\``,
      trimPriority: 4,
    },
    {
      title: "BET LOSERS",
      lines: display.betLoserLines,
      overflow: (hidden) =>
        `…and ${formatInteger(hidden)} more — see \`/bb history\``,
      trimPriority: 4,
    },
    {
      title:
        input.parlay === undefined ? "Parlay" : parlayFieldTitle(input.parlay),
      lines: display.parlayLegLines,
      overflow: (hidden) => `…and ${formatInteger(hidden)} more legs.`,
      trimPriority: 1,
    },
    {
      title: "PARLAY WINNERS",
      lines: display.parlayWinnerLines,
      overflow: (hidden) =>
        `…and ${formatInteger(hidden)} more — see \`/bb history\``,
      trimPriority: 3,
    },
    {
      title: "PARLAY LOSERS",
      lines: display.parlayLoserLines,
      overflow: (hidden) =>
        `…and ${formatInteger(hidden)} more — see \`/bb history\``,
      trimPriority: 3,
    },
    {
      title: "Bucks earned",
      lines: display.earningLines,
      overflow: (hidden) => `…and ${formatInteger(hidden)} more.`,
      trimPriority: 0,
    },
  ];
  const sections = allSections.filter((section) => section.lines.length > 0);

  return {
    embeds: [fitSections(descriptionLines.join("\n"), sections)],
    allowedMentions: { parse: [] },
  };
}
