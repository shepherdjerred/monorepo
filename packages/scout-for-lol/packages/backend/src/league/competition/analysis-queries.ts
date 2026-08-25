import {
  resolveTemporalBucket,
  temporalWindowDays,
  type CompetitionAnalysisPreset,
  type CompetitionCriteria,
  type CompetitionGameVariant,
  type CompetitionQueueType,
  type TemporalAnalysisSpec,
} from "@scout-for-lol/data";

// ── Competition analysis query generation ────────────────────────────────────
// Every competition view is a ScoutQL query, generated as TEXT and compiled
// like any other. v2 has no plan mutation: a bucketed query is one that says
// `GROUP BY DATE_TRUNC(...)`, so a preset writes the grouping it wants rather
// than editing a compiled plan afterwards.

/**
 * The ScoutQL that reproduces a competition's own criterion over a period.
 *
 * The criterion's measure is SELECTed first, because the standings reader
 * takes each row's first value as its score. The query states no time bound:
 * competition queries execute with an explicit `rangeOverride`, so naming a
 * period in the text would name one nothing honours.
 */
export function competitionCriterionQuery(
  criteria: CompetitionCriteria,
  competitionId: number,
  gameVariant: CompetitionGameVariant = "MODERN",
): string {
  const queueCondition = competitionQueueCondition(
    criteria.queues,
    gameVariant,
  );
  if (criteria.type === "MOST_GAMES_PLAYED") {
    return criterionScoutQl({
      competitionId,
      outputs: ["COUNT(*) AS games"],
      orderBy: "games",
      conditions: [queueCondition],
    });
  }
  if (criteria.type === "MOST_WINS_PLAYER") {
    return criterionScoutQl({
      competitionId,
      outputs: ["COUNT(*) FILTER (WHERE win) AS wins"],
      orderBy: "wins",
      conditions: [queueCondition],
    });
  }
  if (criteria.type === "MOST_WINS_CHAMPION") {
    return criterionScoutQl({
      competitionId,
      outputs: ["COUNT(*) FILTER (WHERE win) AS wins"],
      orderBy: "wins",
      conditions: [
        `champion_id = ${criteria.championId.toString()}`,
        queueCondition,
      ],
    });
  }
  if (criteria.type === "HIGHEST_WIN_RATE") {
    return criterionScoutQl({
      competitionId,
      outputs: ["AVG(win::INT) AS win_rate", "COUNT(*) AS games"],
      orderBy: "win_rate",
      conditions: [queueCondition],
      having: `games >= ${criteria.minGames.toString()}`,
    });
  }
  throw new Error(`Competition criterion ${criteria.type} uses rank history.`);
}

function criterionScoutQl(input: {
  competitionId: number;
  outputs: string[];
  orderBy: string;
  conditions: (string | null)[];
  having?: string;
}): string {
  const conditions = [
    `competition_id = ${input.competitionId.toString()}`,
    ...input.conditions.filter((condition) => condition !== null),
  ];
  return [
    `SELECT ${input.outputs.join(", ")}`,
    "FROM competition_match_participants",
    `WHERE ${conditions.join(" AND ")}`,
    "GROUP BY player",
    ...(input.having === undefined ? [] : [`HAVING ${input.having}`]),
    `ORDER BY ${input.orderBy} DESC`,
    `LIMIT 100 RENDER bar_chart WITH (y = ${input.orderBy})`,
  ].join(" ");
}

function competitionQueueCondition(
  queues: readonly CompetitionQueueType[],
  gameVariant: CompetitionGameVariant,
): string {
  if (queues.includes("ALL")) {
    return gameVariant === "CLASSIC"
      ? "queue IN ('classic', 'classic aram mayhem')"
      : "queue NOT IN ('classic', 'classic aram mayhem')";
  }
  const values = queues.filter((queue) => queue !== "ALL");
  return `queue IN (${values.map((value) => `'${value}'`).join(", ")})`;
}

/**
 * The ScoutQL text behind an analysis preset, with the time bucket written
 * inline.
 *
 * v2 has no plan mutation: a bucketed query is one that says
 * `GROUP BY DATE_TRUNC('week', …)`, so the preset generates the grouping it
 * wants rather than editing a compiled plan afterwards. As with the criterion
 * queries, the text states no window — the competition range arrives as a
 * `rangeOverride` at execution.
 */
export function temporalPresetQuery(input: {
  preset: CompetitionAnalysisPreset;
  competitionId: number;
  analysis: TemporalAnalysisSpec;
}): string {
  const bucket = resolveTemporalBucket(
    input.analysis.bucket,
    temporalWindowDays(input.analysis.window),
  );
  const bucketExpr =
    bucket === "patch"
      ? "patch"
      : `DATE_TRUNC('${bucket}', game_creation_at AT TIME ZONE '${input.analysis.timezone}')`;
  const where = `WHERE competition_id = ${input.competitionId.toString()}`;
  const from = `FROM competition_match_participants ${where}`;
  if (input.preset === "games_wins") {
    return [
      `SELECT ${bucketExpr} AS bucket, COUNT(*) AS games, COUNT(*) FILTER (WHERE win) AS wins`,
      from,
      `GROUP BY ${bucketExpr} ORDER BY bucket ASC`,
      "RENDER line_chart WITH (y = (games, wins), trend = true, sparkline = true)",
    ].join(" ");
  }
  if (input.preset === "performance") {
    return [
      `SELECT ${bucketExpr} AS bucket, AVG(win::INT) AS win_rate, kda() AS kda`,
      from,
      `GROUP BY ${bucketExpr} ORDER BY bucket ASC`,
      "RENDER line_chart WITH (y = (win_rate, kda), rolling = 3, trend = true, sparkline = true)",
    ].join(" ");
  }
  return [
    `SELECT queue, ${bucketExpr} AS bucket, COUNT(*) AS games`,
    from,
    `GROUP BY queue, ${bucketExpr} ORDER BY bucket ASC`,
    "RENDER area_chart WITH (y = games, stack = percent, annotations = true)",
  ].join(" ");
}
