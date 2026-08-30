import { formatInteger } from "@scout-for-lol/data";
import {
  WEEKLY_PARLAY_SETTLEMENT_MIN_GAMES,
  type WeeklyParlayDefinitionCriteria,
  type WeeklyParlayLeg,
} from "#src/betting/weekly-parlay-criteria.ts";
import type { WeeklyParlayEvaluation } from "#src/betting/weekly-parlay-evaluator.ts";

export type WeeklyParlayDiscordKind =
  "open" | "reminder" | "progress" | "settlement";

function operatorCopy(leg: WeeklyParlayLeg): string {
  switch (leg.operator) {
    case "gte":
      return "at least";
    case "lte":
      return "at most";
    case "eq":
      return "exactly";
  }
}

export function countLabel(
  value: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return value === 1 ? singular : plural;
}

function aggregateMetricCopy(
  metric: Extract<WeeklyParlayLeg, { kind: "aggregate" }>["metric"],
  threshold: number,
): string {
  switch (metric) {
    case "games":
    case "wins":
    case "kills":
    case "deaths":
    case "assists":
      return countLabel(threshold, metric.slice(0, -1), metric);
    case "distinct_champions":
      return `distinct ${countLabel(threshold, "champion")}`;
    case "distinct_roles":
      return `distinct ${countLabel(threshold, "role")}`;
    case "longest_win_streak":
      return "wins in a row";
    case "best_game_kills":
      return "kills in one game";
    case "best_game_assists":
      return "assists in one game";
    case "best_game_damage":
      return "champion damage in one game";
    case "champion_damage":
    case "creep_score":
    case "gold":
    case "vision_score":
    case "time_played":
      return metric.replaceAll("_", " ");
  }
}

function metricCopy(leg: WeeklyParlayLeg): string {
  switch (leg.kind) {
    case "aggregate":
      return aggregateMetricCopy(leg.metric, leg.threshold);
    case "rate":
      return leg.metric
        .replaceAll("_x100", "")
        .replaceAll("_bps", "")
        .replaceAll("_", " ");
    case "champion_games":
      return `${countLabel(leg.threshold, leg.winsOnly ? "win" : "game")} on ${leg.champion}`;
    case "role_games":
      return `${countLabel(leg.threshold, leg.winsOnly ? "win" : "game")} as ${leg.role.toLowerCase()}`;
    case "champion_peak":
      return `${leg.metric.replaceAll("_", " ")} in one game as ${leg.champion}`;
  }
}

function metricValue(leg: WeeklyParlayLeg, value: number): string {
  if (leg.kind === "rate") {
    if (leg.metric === "win_rate_bps") {
      return `${(value / 100).toFixed(1)}%`;
    }
    if (leg.metric.endsWith("_x100")) {
      return (value / 100).toFixed(2);
    }
  }
  return value.toLocaleString("en-US");
}

export function legLine(input: {
  leg: WeeklyParlayLeg;
  current: number | undefined;
  subjectAlias: string;
  kind?: WeeklyParlayDiscordKind;
  passed?: boolean;
}): string {
  const kind = input.kind ?? "open";
  const status =
    input.current === undefined
      ? "•"
      : kind === "settlement"
        ? input.passed === true
          ? "✅"
          : "❌"
        : input.passed === true
          ? "✅"
          : "⏳";
  const progress =
    input.current === undefined
      ? ""
      : ` (${metricValue(input.leg, input.current)} / ${metricValue(input.leg, input.leg.threshold)})`;
  return `${status} **${input.subjectAlias}** — ${operatorCopy(input.leg)} **${metricValue(input.leg, input.leg.threshold)} ${metricCopy(input.leg)}**${progress}`;
}

export function weeklyParlayQualificationCopy(
  criteria: WeeklyParlayDefinitionCriteria,
): string | undefined {
  if (criteria.version === 1) {
    return;
  }
  return `Settlement requires **${criteria.qualification.minimumGamesPerSubject.toString()} eligible games** from every featured player.`;
}

function weeklyParlayVoidReasonCopy(reason: string | null): string {
  switch (reason) {
    case "insufficient_activity":
      return `Not every featured player completed ${WEEKLY_PARLAY_SETTLEMENT_MIN_GAMES.toString()} eligible games.`;
    case "operator_cancelled":
      return "An operator cancelled this market.";
    case null:
      return "The market was voided without a recorded result.";
    default:
      return `The market was voided because of ${reason}.`;
  }
}

export function deliveryTitle(input: {
  kind: WeeklyParlayDiscordKind;
  marketState: string;
  yesResult: boolean | null;
  voidReason?: string | null;
}): string {
  switch (input.kind) {
    case "open":
      return "📅 **Weekly Bryan Bucks parlay: OPEN FOR BETTING**";
    case "reminder":
      return "⏰ **Weekly Bryan Bucks parlay: BETTING REMINDER**";
    case "progress":
      return "📈 **Weekly Bryan Bucks parlay: IN PROGRESS**";
    case "settlement":
      if (input.marketState === "voided") {
        if (input.voidReason === "operator_cancelled") {
          return "🛑 **Weekly Bryan Bucks parlay: CANCELLED — BETS REFUNDED**";
        }
        return "↩️ **Weekly Bryan Bucks parlay: VOIDED — BETS REFUNDED**";
      }
      return input.yesResult === true
        ? "✅ **Weekly Bryan Bucks parlay: RESOLVED YES**"
        : "❌ **Weekly Bryan Bucks parlay: RESOLVED NO**";
  }
}

export function deliveryTimeCopy(input: {
  kind: WeeklyParlayDiscordKind;
  bettingClosesAt: Date;
  scoringEndsAt: Date;
  scoringStartsAt?: Date;
}): string {
  const timestamp = (date: Date, style: "F" | "R"): string =>
    `<t:${Math.floor(date.getTime() / 1000).toString()}:${style}>`;
  if (input.kind === "open" || input.kind === "reminder") {
    return [
      `**Betting closes:** ${timestamp(input.bettingClosesAt, "F")} (${timestamp(input.bettingClosesAt, "R")})`,
      `**Scoring window:** ${timestamp(input.scoringStartsAt ?? input.bettingClosesAt, "F")} → ${timestamp(input.scoringEndsAt, "F")}`,
    ].join("\n");
  }
  return `**Scoring cutoff:** ${timestamp(input.scoringEndsAt, "F")}`;
}

function qualificationLines(input: {
  kind: WeeklyParlayDiscordKind;
  criteria: WeeklyParlayDefinitionCriteria | undefined;
  evaluation: WeeklyParlayEvaluation | undefined;
  aliases: ReadonlyMap<string, string>;
}): string[] {
  if (input.criteria?.version !== 2) {
    return [];
  }
  if (
    input.evaluation === undefined ||
    input.kind === "open" ||
    input.kind === "reminder"
  ) {
    const requirement = weeklyParlayQualificationCopy(input.criteria);
    if (requirement === undefined) {
      throw new Error("Version-two weekly parlay requires qualification copy.");
    }
    return [`**Activity requirement:** ${requirement}`];
  }
  const minimumGames = input.evaluation.qualification.minimumGamesPerSubject;
  return [
    "**Activity qualification:**",
    ...input.evaluation.qualification.subjects.map((subject) => {
      const status = subject.passed
        ? "✅"
        : input.kind === "settlement"
          ? "❌"
          : "⏳";
      const qualification = subject.passed ? " (qualified)" : "";
      const alias = input.aliases.get(subject.subject) ?? subject.subject;
      return `• ${status} **${alias}** — ${subject.games.toString()}/${minimumGames.toString()} eligible games${qualification}`;
    }),
  ];
}

function settlementLines(input: {
  kind: WeeklyParlayDiscordKind;
  marketState: string;
  yesResult: boolean | null;
  voidReason: string | null;
  evaluation: WeeklyParlayEvaluation | undefined;
  bettorCount: number;
  totalStaked: number;
}): string[] {
  if (input.kind !== "settlement") {
    return [];
  }
  if (input.marketState === "voided") {
    return [
      `**Why:** ${weeklyParlayVoidReasonCopy(input.voidReason)}`,
      `**Returned:** ${formatInteger(input.bettorCount)} ${countLabel(input.bettorCount, "bettor")} · ${formatInteger(input.totalStaked)} BB`,
    ];
  }
  if (input.evaluation === undefined) {
    throw new Error("Settled weekly parlay delivery requires evaluation.");
  }
  const failedLegs = input.evaluation.legs.filter((leg) => !leg.passed).length;
  const result =
    input.yesResult === true
      ? "All conditions passed."
      : `${failedLegs.toString()} of ${input.evaluation.legs.length.toString()} conditions failed.`;
  return [`**${result}**`];
}

export function weeklyParlayDeliveryContent(input: {
  kind: WeeklyParlayDiscordKind;
  marketState: string;
  yesResult: boolean | null;
  voidReason: string | null;
  bettingClosesAt: Date;
  scoringStartsAt: Date;
  scoringEndsAt: Date;
  criteria: WeeklyParlayDefinitionCriteria | undefined;
  evaluation: WeeklyParlayEvaluation | undefined;
  aliases: ReadonlyMap<string, string>;
  bettorCount: number;
  totalStaked: number;
}): string {
  if (input.kind !== "settlement" && input.criteria === undefined) {
    throw new Error("Weekly parlay delivery requires criteria.");
  }
  if (
    input.kind === "settlement" &&
    input.marketState !== "voided" &&
    (input.criteria === undefined || input.evaluation === undefined)
  ) {
    throw new Error("Settled weekly parlay delivery requires evaluation.");
  }
  const legs =
    input.evaluation === undefined
      ? (input.criteria?.legs.map((leg) =>
          legLine({
            leg,
            current: undefined,
            subjectAlias: input.aliases.get(leg.subject) ?? leg.subject,
            kind: input.kind,
          }),
        ) ?? [])
      : input.evaluation.legs.map((result) =>
          legLine({
            leg: result.leg,
            current:
              input.kind === "open" || input.kind === "reminder"
                ? undefined
                : result.current,
            subjectAlias:
              input.aliases.get(result.leg.subject) ?? result.leg.subject,
            kind: input.kind,
            passed: result.passed,
          }),
        );
  const sections = [
    deliveryTitle({
      kind: input.kind,
      marketState: input.marketState,
      yesResult: input.yesResult,
      voidReason: input.voidReason,
    }),
    settlementLines(input).join("\n"),
    legs.length === 0 ? "" : ["**Conditions**", ...legs].join("\n"),
    qualificationLines({
      kind: input.kind,
      criteria: input.criteria,
      evaluation: input.evaluation,
      aliases: input.aliases,
    }).join("\n"),
    input.marketState === "voided" && input.kind === "settlement"
      ? ""
      : `**Bets:** ${formatInteger(input.bettorCount)} ${countLabel(input.bettorCount, "bettor")} · ${formatInteger(input.totalStaked)} BB staked`,
    deliveryTimeCopy({
      kind: input.kind,
      bettingClosesAt: input.bettingClosesAt,
      scoringEndsAt: input.scoringEndsAt,
      scoringStartsAt: input.scoringStartsAt,
    }),
  ];
  return sections.filter((section) => section.length > 0).join("\n\n");
}
