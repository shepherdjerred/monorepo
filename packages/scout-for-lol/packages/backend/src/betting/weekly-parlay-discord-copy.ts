import { formatInteger } from "@scout-for-lol/data";
import type {
  WeeklyParlayDefinitionCriteria,
  WeeklyParlayLeg,
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

export function legLine(
  leg: WeeklyParlayLeg,
  current: number | undefined,
  subjectAlias: string,
): string {
  const progress =
    current === undefined
      ? ""
      : ` — **${metricValue(leg, current)} / ${metricValue(leg, leg.threshold)}**`;
  return `• **${subjectAlias}** ${operatorCopy(leg)} **${metricValue(leg, leg.threshold)} ${metricCopy(leg)}**${progress}`;
}

export function weeklyParlayQualificationCopy(
  criteria: WeeklyParlayDefinitionCriteria,
): string | undefined {
  if (criteria.version === 1) {
    return;
  }
  return `Settlement qualification: **${criteria.qualification.minimumGamesPerSubject.toString()} eligible games required per player**; otherwise all bets are refunded.`;
}

function weeklyParlayVoidCopy(reason: string | null): string {
  switch (reason) {
    case "insufficient_activity":
      return "Fewer than three eligible games were played, so every wager was refunded.";
    case "operator_cancelled":
      return "Cancelled by an operator; every pending wager was refunded.";
    case null:
      return "The market was voided and every pending wager was refunded.";
    default:
      return `The market was voided (${reason}) and every pending wager was refunded.`;
  }
}

export function deliveryTitle(input: {
  kind: WeeklyParlayDiscordKind;
  marketState: string;
  yesResult: boolean | null;
  catchup?: boolean;
  voidReason?: string | null;
}): string {
  const prefix = input.catchup === true ? "Catch-up weekly" : "Weekly";
  switch (input.kind) {
    case "open":
      return `📅 **${prefix} Bryan Bucks parlay is open**`;
    case "reminder":
      return `⏰ **${prefix} parlay betting reminder**`;
    case "progress":
      return `📈 **${prefix} parlay progress**`;
    case "settlement":
      if (input.marketState === "voided") {
        if (input.voidReason === "operator_cancelled") {
          return `🛑 **${prefix} parlay cancelled and refunded**`;
        }
        return `↩️ **${prefix} parlay refunded**`;
      }
      return input.yesResult === true
        ? `✅ **${prefix} parlay settled YES**`
        : `❌ **${prefix} parlay settled NO**`;
  }
}

export function deliveryTimeCopy(input: {
  kind: WeeklyParlayDiscordKind;
  bettingClosesAt: Date;
  scoringEndsAt: Date;
  scoringStartsAt?: Date;
  catchup?: boolean;
}): string {
  if (input.catchup === true) {
    if (input.scoringStartsAt === undefined) {
      throw new Error("Catch-up weekly parlay copy requires scoringStartsAt.");
    }
    return `Betting closes <t:${Math.floor(input.bettingClosesAt.getTime() / 1000).toString()}:F>. Scoring runs <t:${Math.floor(input.scoringStartsAt.getTime() / 1000).toString()}:F> through <t:${Math.floor(input.scoringEndsAt.getTime() / 1000).toString()}:F>.`;
  }
  if (input.kind === "open" || input.kind === "reminder") {
    return `Betting closes <t:${Math.floor(input.bettingClosesAt.getTime() / 1000).toString()}:R>. Use this message's buttons so your market is unambiguous.`;
  }
  return `Final cutoff <t:${Math.floor(input.scoringEndsAt.getTime() / 1000).toString()}:F>.`;
}

export function weeklyParlayDeliveryContent(input: {
  kind: WeeklyParlayDiscordKind;
  marketState: string;
  yesResult: boolean | null;
  voidReason: string | null;
  catchup: boolean;
  periodKey: string;
  yesProbabilityBps: number;
  bettingClosesAt: Date;
  scoringStartsAt: Date;
  scoringEndsAt: Date;
  criteria: WeeklyParlayDefinitionCriteria | undefined;
  evaluation: WeeklyParlayEvaluation | undefined;
  aliases: ReadonlyMap<string, string>;
  bettorCount: number;
  totalStaked: number;
}): string {
  const isVoidedSettlement =
    input.kind === "settlement" && input.marketState === "voided";
  if (
    !isVoidedSettlement &&
    (input.criteria === undefined || input.evaluation === undefined)
  ) {
    throw new Error("Non-void weekly parlay delivery requires evaluation.");
  }
  const legs =
    input.evaluation?.legs.map((result) =>
      legLine(
        result.leg,
        input.kind === "open" || input.kind === "reminder"
          ? undefined
          : result.current,
        input.aliases.get(result.leg.subject) ?? result.leg.subject,
      ),
    ) ?? [];
  const qualification =
    input.criteria === undefined
      ? undefined
      : weeklyParlayQualificationCopy(input.criteria);
  const minimumGames =
    input.evaluation?.qualification.minimumGamesPerSubject ?? 0;
  const qualificationProgress =
    minimumGames === 0 ||
    input.kind === "open" ||
    input.kind === "reminder" ||
    input.evaluation === undefined
      ? undefined
      : `Qualification: ${input.evaluation.qualification.subjects
          .map((subject) => {
            const alias = input.aliases.get(subject.subject) ?? subject.subject;
            return `**${alias} ${subject.games.toString()}/${minimumGames.toString()} games**`;
          })
          .join(" · ")}`;
  return [
    deliveryTitle({
      kind: input.kind,
      marketState: input.marketState,
      yesResult: input.yesResult,
      catchup: input.catchup,
      voidReason: input.voidReason,
    }),
    ...(isVoidedSettlement ? [weeklyParlayVoidCopy(input.voidReason)] : []),
    `Period: **${input.periodKey}** · ${(input.yesProbabilityBps / 100).toFixed(1)}% YES`,
    ...legs,
    qualification ?? "",
    qualificationProgress ?? "",
    `**${formatInteger(input.bettorCount)} ${countLabel(input.bettorCount, "bettor")} · ${formatInteger(input.totalStaked)} BB staked**`,
    deliveryTimeCopy({
      kind: input.kind,
      bettingClosesAt: input.bettingClosesAt,
      scoringEndsAt: input.scoringEndsAt,
      scoringStartsAt: input.scoringStartsAt,
      catchup: input.catchup,
    }),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
