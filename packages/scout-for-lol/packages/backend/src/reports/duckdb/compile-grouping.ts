import type { ReportGroupBy } from "@scout-for-lol/data";
import { match } from "ts-pattern";
import { scalarParam, type BoundParam } from "#src/reports/duckdb/lake.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";

/**
 * GROUP BY shape for a compiled lake query: the label expression, the raw
 * grouping expressions, and the Discord-mention expression that goes with
 * them.
 *
 * Every string here is assembled from closed enums and our own column
 * constants — never from user input — so it is safe to embed in SQL text.
 * Runtime values (a timezone, for instance) still travel as bound params.
 */

type Grouping = {
  labelExpr: string;
  discordExpr: string;
  groupExprs: string[];
  labelParams?: BoundParam[];
  groupParams?: BoundParam[];
};

type GroupingOptions = {
  groupBy: ReportGroupBy;
  timezone: string;
  scope: LakeQueryScope;
  timeColumn?: "game_creation_at" | "observed_at";
};

function singleMatchGrouping(options: GroupingOptions): Grouping {
  const { groupBy, timezone, scope } = options;
  const timeColumn = options.timeColumn ?? "game_creation_at";
  return match(groupBy)
    .with("player", () =>
      // Global scope has no accounts join, so identity is the account itself:
      // group by puuid and label with the Riot ID the facts CTE aliased into
      // player_alias. player_id/discord_id stay NULL, which is what keeps
      // leaderboard @mentions from resolving (mention-format falls back to the
      // label) — correct, since a global row is not a tracked player.
      //
      // The label is the player's MOST RECENT Riot ID, not an arbitrary one.
      // A Riot ID is a display name that changes, and grouping is by puuid, so
      // `any_value` picked whichever historical name a row happened to carry —
      // a renamed player could be labelled with a name they no longer use, and
      // two runs of the same query could disagree.
      scope.kind === "global"
        ? {
            labelExpr: `arg_max(player_alias, ${timeColumn})`,
            discordExpr: "NULL::VARCHAR",
            groupExprs: ["puuid"],
          }
        : {
            labelExpr: "any_value(player_alias)",
            discordExpr: "any_value(discord_id)",
            groupExprs: ["player_id"],
          },
    )
    .with("champion", () => ({
      labelExpr: "any_value(champion_name)",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["champion_id"],
    }))
    .with("queue", () => ({
      labelExpr: "COALESCE(queue, 'unknown')",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["COALESCE(queue, 'unknown')"],
    }))
    .with("team_position", () => textGrouping("team_position"))
    .with("individual_position", () => textGrouping("individual_position"))
    .with("lane", () => textGrouping("lane"))
    .with("role", () => textGrouping("role"))
    .with("game_mode", () => textGrouping("game_mode"))
    .with("game_type", () => textGrouping("game_type"))
    .with("patch", () => ({
      labelExpr: String.raw`regexp_extract(any_value(game_version), '^[0-9]+\.[0-9]+')`,
      discordExpr: "NULL::VARCHAR",
      groupExprs: [String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`],
    }))
    .with("map", () => ({
      labelExpr: "any_value(map_id)::VARCHAR",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["map_id"],
    }))
    .with("outcome", () => ({
      labelExpr: "CASE WHEN win THEN 'Win' ELSE 'Loss' END",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["win"],
    }))
    .with("surrender_state", () => ({
      labelExpr:
        "CASE WHEN early_surrendered THEN 'Early surrender' WHEN surrendered THEN 'Surrender' ELSE 'Played out' END",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["early_surrendered", "surrendered"],
    }))
    .with("arena_placement", () => ({
      labelExpr: "COALESCE(placement::VARCHAR, 'Not Arena')",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["placement"],
    }))
    .with("day", () => timeGrouping("day", "%Y-%m-%d", timezone, timeColumn))
    .with("week", () => timeGrouping("week", "%Y-%m-%d", timezone, timeColumn))
    .with("month", () => timeGrouping("month", "%Y-%m", timezone, timeColumn))
    .with("all", () => ({
      labelExpr: "'All'",
      discordExpr: "NULL::VARCHAR",
      groupExprs: [],
    }))
    .with("group", () => {
      throw new Error("group grouping uses compileGroupFactsQuery");
    })
    .exhaustive();
}

function textGrouping(column: string): Grouping {
  const expression = `COALESCE(${column}, 'unknown')`;
  return {
    labelExpr: `any_value(${expression})`,
    discordExpr: "NULL::VARCHAR",
    groupExprs: [expression],
  };
}

function timeGrouping(
  unit: "day" | "week" | "month",
  format: string,
  timezone: string,
  timeColumn: "game_creation_at" | "observed_at",
): Grouping {
  const expression =
    timezone === "UTC"
      ? `date_trunc('${unit}', ${timeColumn})`
      : `date_trunc('${unit}', timezone(?, timezone('UTC', ${timeColumn})))`;
  const params = timezone === "UTC" ? [] : [scalarParam(timezone)];
  return {
    labelExpr: `strftime(any_value(${expression}), '${format}')`,
    discordExpr: "NULL::VARCHAR",
    groupExprs: [expression],
    labelParams: params,
    groupParams: params,
  };
}

export function matchGrouping(options: {
  groupBys: ReportGroupBy[];
  timezone: string;
  scope: LakeQueryScope;
  timeColumn?: "game_creation_at" | "observed_at";
  prematch?: boolean;
}): Grouping {
  const { groupBys, timezone, scope } = options;
  const prematch = options.prematch ?? false;
  const groupings = groupBys.map((groupBy) => {
    const grouping = singleMatchGrouping({
      groupBy,
      timezone,
      scope,
      ...(options.timeColumn === undefined
        ? {}
        : { timeColumn: options.timeColumn }),
    });
    return prematch && groupBy === "champion"
      ? { ...grouping, labelExpr: "any_value(champion_id::VARCHAR)" }
      : grouping;
  });
  const labels = groupings.map((grouping) => grouping.labelExpr);
  return {
    labelExpr:
      labels.length === 1
        ? (labels[0] ?? "'All'")
        : `concat_ws(' • ', ${labels.join(", ")})`,
    discordExpr:
      groupBys.includes("player") && scope.kind === "guild"
        ? "any_value(discord_id)"
        : "NULL::VARCHAR",
    groupExprs: groupings.flatMap((grouping) => grouping.groupExprs),
    labelParams: groupings.flatMap((grouping) => grouping.labelParams ?? []),
    groupParams: groupings.flatMap((grouping) => grouping.groupParams ?? []),
  };
}
