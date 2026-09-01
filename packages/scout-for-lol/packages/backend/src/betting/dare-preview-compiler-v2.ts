import {
  MATCH_LAKE_COLUMNS,
  normalizeChampionName,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  type DareBooleanExpressionV2,
  type DareCompiledPlanV2,
  type DareGameSetV2,
  type DareResultExpressionV2,
  type DareTargetBindingV2,
  type DareValueV2,
} from "@scout-for-lol/data";
import {
  buildMatchesSource,
  buildTimelineCoverageSource,
  buildTimelineEventParticipantsSource,
  buildTimelineEventsSource,
  listParam,
  scalarParam,
  type BoundParam,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import {
  frag,
  joinFragments,
  parenthesize,
  seq,
} from "#src/reports/duckdb/sql-fragment.ts";
import { darePlanNeedsTimeline } from "#src/betting/dare-timeline-evidence-v2.ts";

const PARTICIPANT_COLUMNS: Record<
  Extract<DareValueV2, { kind: "participant" }>["field"],
  keyof typeof MATCH_LAKE_COLUMNS
> = {
  champion_name: "champion_name",
  team_position: "team_position",
  team_id: "team_id",
  win: "win",
  kills: "kills",
  deaths: "deaths",
  assists: "assists",
  creep_score: "creep_score",
  gold_earned: "gold_earned",
  vision_score: "vision_score",
  time_played: "time_played",
  total_damage_dealt_to_champions: "total_damage_dealt_to_champions",
  wards_placed: "wards_placed",
  wards_killed: "wards_killed",
  double_kills: "double_kills",
  triple_kills: "triple_kills",
  quadra_kills: "quadra_kills",
  penta_kills: "penta_kills",
};

type CompileContext = {
  gameSet: DareGameSetV2;
};

export type CompiledDarePreviewV2 = {
  sql: string;
  params: BoundParam[];
};

function emptyRelation(
  columns: Record<
    string,
    "VARCHAR" | "INTEGER" | "BIGINT" | "DOUBLE" | "BOOLEAN" | "TIMESTAMP"
  >,
): SqlFragment {
  return frag(
    `SELECT ${Object.entries(columns)
      .map(([name, type]) => `NULL::${type} AS ${name}`)
      .join(", ")} WHERE FALSE`,
  );
}

function sourceOrEmpty(
  source: SqlFragment | undefined,
  columns: Parameters<typeof emptyRelation>[0],
): SqlFragment {
  return source ?? emptyRelation(columns);
}

function operator(value: "eq" | "neq" | "gte" | "lte" | "gt" | "lt") {
  if (value === "eq") return "=";
  if (value === "neq") return "<>";
  if (value === "gte") return ">=";
  if (value === "lte") return "<=";
  if (value === "gt") return ">";
  return "<";
}

function targetAlias(gameSet: DareGameSetV2, targetKey: string): string {
  const index = gameSet.targetKeys.indexOf(targetKey);
  if (index === -1) {
    throw new Error(
      `Game set ${gameSet.name} references unbound target ${targetKey}.`,
    );
  }
  return `p${index.toString()}`;
}

function timelineCount(
  value: Extract<DareValueV2, { kind: "timeline_event_count" }>,
  context: CompileContext,
): SqlFragment {
  const participantJoin =
    value.target === null
      ? frag("")
      : seq(
          " INNER JOIN timeline_event_participants AS tep ON tep.event_id = te.event_id AND tep.puuid = ",
          `${targetAlias(context.gameSet, value.target)}.puuid`,
          value.role === null
            ? frag("")
            : frag(" AND tep.role = ?", [scalarParam(value.role)]),
        );
  const filters = [
    frag("te.match_id = p0.match_id"),
    frag("te.event_type = ?", [scalarParam(value.eventType)]),
    ...(value.afterMs === null
      ? []
      : [frag("te.event_timestamp_ms >= ?", [scalarParam(value.afterMs)])]),
    ...(value.beforeMs === null
      ? []
      : [frag("te.event_timestamp_ms <= ?", [scalarParam(value.beforeMs)])]),
    ...(value.itemId === null
      ? []
      : [frag("te.item_id = ?", [scalarParam(value.itemId)])]),
  ];
  return seq(
    "CASE WHEN EXISTS (SELECT 1 FROM timeline_coverage AS tc WHERE tc.match_id = p0.match_id AND tc.coverage_state = 'complete') THEN (SELECT COUNT(DISTINCT te.event_id) FROM timeline_events AS te",
    participantJoin,
    " WHERE ",
    joinFragments(filters, " AND "),
    ") ELSE NULL END",
  );
}

function relatedParticipantCount(
  value: Extract<DareValueV2, { kind: "related_participant_count" }>,
  context: CompileContext,
): SqlFragment {
  const alias = targetAlias(context.gameSet, value.target);
  const relationship =
    value.relationship === "ally"
      ? `rp.team_id = ${alias}.team_id AND rp.puuid <> ${alias}.puuid`
      : `rp.team_id <> ${alias}.team_id`;
  const champion =
    value.championName === null
      ? frag("")
      : frag(" AND rp.champion_name = ?", [
          scalarParam(normalizeChampionName(value.championName)),
        ]);
  return seq(
    "(SELECT COUNT(*) FROM match_participants AS rp WHERE rp.match_id = p0.match_id AND ",
    relationship,
    champion,
    ")",
  );
}

function valueFragment(
  value: DareValueV2,
  context: CompileContext,
): SqlFragment {
  if (value.kind === "participant") {
    return frag(
      `${targetAlias(context.gameSet, value.target)}.${PARTICIPANT_COLUMNS[value.field]}`,
    );
  }
  if (value.kind === "participant_rate") {
    const alias = targetAlias(context.gameSet, value.target);
    if (value.field === "cs_per_minute") {
      return frag(
        `(${alias}.creep_score * 60.0 / NULLIF(${alias}.time_played, 0))`,
      );
    }
    if (value.field === "damage_per_minute") {
      return frag(
        `(${alias}.total_damage_dealt_to_champions * 60.0 / NULLIF(${alias}.time_played, 0))`,
      );
    }
    return frag(
      `((${alias}.kills + ${alias}.assists) * 1.0 / GREATEST(${alias}.deaths, 1))`,
    );
  }
  if (value.kind === "game") {
    return frag(
      value.field === "duration_seconds"
        ? "p0.game_duration_seconds"
        : "p0.queue",
    );
  }
  if (value.kind === "related_participant_count") {
    return relatedParticipantCount(value, context);
  }
  if (value.kind === "arithmetic") {
    const left = valueFragment(value.left, context);
    const right = valueFragment(value.right, context);
    if (value.operator === "divide") {
      return seq("(", left, " / NULLIF(", right, ", 0))");
    }
    const arithmeticOperator = {
      add: "+",
      subtract: "-",
      multiply: "*",
    }[value.operator];
    return seq("(", left, ` ${arithmeticOperator} `, right, ")");
  }
  return timelineCount(value, context);
}

function predicateFragment(
  expression: DareBooleanExpressionV2,
  context: CompileContext,
): SqlFragment {
  if (expression.kind === "comparison") {
    return seq(
      valueFragment(expression.value, context),
      ` ${operator(expression.operator)} `,
      frag("?", [scalarParam(expression.threshold)]),
    );
  }
  if (expression.kind === "not") {
    return seq(
      "NOT ",
      parenthesize(predicateFragment(expression.operand, context)),
    );
  }
  return parenthesize(
    joinFragments(
      expression.operands.map((operand) => predicateFragment(operand, context)),
      expression.kind === "and" ? " AND " : " OR ",
    ),
  );
}

function targetPuuids(
  key: string,
  targets: ReadonlyMap<string, DareTargetBindingV2>,
): string[] {
  const target = targets.get(key);
  if (target === undefined) throw new Error(`Unknown Dare v2 target ${key}.`);
  return target.accounts.map((account) => account.puuid);
}

function rawGameSet(
  gameSet: DareGameSetV2,
  index: number,
  targets: ReadonlyMap<string, DareTargetBindingV2>,
): SqlFragment {
  const context = { gameSet };
  const joins = gameSet.targetKeys.slice(1).map((_key, targetIndex) => {
    const alias = `p${(targetIndex + 1).toString()}`;
    const teamClause =
      gameSet.relationship === "same_team"
        ? ` AND ${alias}.team_id = p0.team_id`
        : gameSet.relationship === "opponents"
          ? ` AND ${alias}.team_id <> p0.team_id`
          : "";
    return ` INNER JOIN match_participants AS ${alias} ON ${alias}.match_id = p0.match_id${teamClause}`;
  });
  const bindings = gameSet.targetKeys.map((key, targetIndex) =>
    frag(`p${targetIndex.toString()}.puuid IN (SELECT unnest(?))`, [
      listParam(targetPuuids(key, targets)),
    ]),
  );
  const predicate = predicateFragment(gameSet.predicate, context);
  const projections = gameSet.projections.map((projection, projectionIndex) =>
    seq(
      ", ",
      valueFragment(projection.value, context),
      ` AS projection_${index.toString()}_${projectionIndex.toString()}`,
    ),
  );
  return seq(
    `raw_game_set_${index.toString()} AS (SELECT p0.match_id, p0.game_end_at, `,
    predicate,
    ` AS matched`,
    ...projections,
    " FROM match_participants AS p0",
    ...joins,
    " WHERE ",
    joinFragments(
      [
        ...bindings,
        frag("p0.queue IN (SELECT unnest(?))", [listParam(gameSet.queues)]),
      ],
      " AND ",
    ),
    ")",
  );
}

function resultFragment(
  expression: DareResultExpressionV2,
  setIndex: ReadonlyMap<string, number>,
  plan: DareCompiledPlanV2,
): SqlFragment {
  if (expression.kind === "matching_games") {
    const index = setIndex.get(expression.gameSet);
    if (index === undefined)
      throw new Error(`Unknown game set ${expression.gameSet}.`);
    const comparison = operator(expression.operator);
    return frag(
      `(SELECT CASE WHEN (lower_bound ${comparison} ?) = (upper_bound ${comparison} ?) THEN (lower_bound ${comparison} ?) ELSE NULL END FROM (SELECT COUNT(*) FILTER (WHERE matched IS TRUE) AS lower_bound, COUNT(*) FILTER (WHERE matched IS NOT FALSE) AS upper_bound FROM game_set_${index.toString()}))`,
      [
        scalarParam(expression.threshold),
        scalarParam(expression.threshold),
        scalarParam(expression.threshold),
      ],
    );
  }
  if (expression.kind === "aggregate") {
    const index = setIndex.get(expression.gameSet);
    if (index === undefined)
      throw new Error(`Unknown game set ${expression.gameSet}.`);
    const gameSet = plan.gameSets[index];
    const projectionIndex = gameSet?.projections.findIndex(
      (projection) => projection.name === expression.projection,
    );
    if (projectionIndex === undefined || projectionIndex < 0) {
      throw new Error(
        `Unknown projection ${expression.gameSet}.${expression.projection}.`,
      );
    }
    const aggregate = {
      sum: "SUM",
      average: "AVG",
      minimum: "MIN",
      maximum: "MAX",
    }[expression.function];
    return frag(
      `CASE WHEN EXISTS (SELECT 1 FROM game_set_${index.toString()} WHERE matched IS NULL OR (matched IS TRUE AND projection_${index.toString()}_${projectionIndex.toString()} IS NULL)) THEN NULL WHEN NOT EXISTS (SELECT 1 FROM game_set_${index.toString()} WHERE matched IS TRUE) THEN FALSE ELSE (SELECT ${aggregate}(projection_${index.toString()}_${projectionIndex.toString()}) FROM game_set_${index.toString()} WHERE matched IS TRUE) ${operator(expression.operator)} ? END`,
      [scalarParam(expression.threshold)],
    );
  }
  if (expression.kind === "not") {
    return seq(
      "NOT ",
      parenthesize(resultFragment(expression.operand, setIndex, plan)),
    );
  }
  return parenthesize(
    joinFragments(
      expression.operands.map((operand) =>
        resultFragment(operand, setIndex, plan),
      ),
      expression.kind === "and" ? " AND " : " OR ",
    ),
  );
}

export function compileDarePreviewQueryV2(input: {
  plan: DareCompiledPlanV2;
  targets: readonly DareTargetBindingV2[];
  files: LakeFiles;
  start: Date;
  end: Date;
}): CompiledDarePreviewV2 {
  const matchSource = sourceOrEmpty(
    buildMatchesSource(input.files, {
      sql: "end_of_game_result = 'GameComplete' AND epoch_ms(game_end_at) >= ? AND epoch_ms(game_end_at) <= ?",
      params: [
        scalarParam(input.start.getTime()),
        scalarParam(input.end.getTime()),
      ],
    }),
    MATCH_LAKE_COLUMNS,
  );
  const needsTimeline = darePlanNeedsTimeline(input.plan);
  const sources: SqlFragment[] = [
    seq("match_participants AS (", matchSource, ")"),
  ];
  if (needsTimeline) {
    sources.push(
      seq(
        "timeline_events AS (",
        sourceOrEmpty(
          buildTimelineEventsSource(input.files, frag("")),
          TIMELINE_EVENT_LAKE_COLUMNS,
        ),
        ")",
      ),
      seq(
        "timeline_event_participants AS (",
        sourceOrEmpty(
          buildTimelineEventParticipantsSource(input.files, frag("")),
          TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
        ),
        ")",
      ),
      seq(
        "timeline_coverage AS (",
        sourceOrEmpty(
          buildTimelineCoverageSource(input.files, frag("")),
          TIMELINE_COVERAGE_LAKE_COLUMNS,
        ),
        ")",
      ),
    );
  }
  const targets = new Map(input.targets.map((target) => [target.key, target]));
  const rawSets = input.plan.gameSets.map((gameSet, index) =>
    rawGameSet(gameSet, index, targets),
  );
  const eligibleUnion = input.plan.gameSets
    .map(
      (_gameSet, index) =>
        `SELECT match_id, game_end_at FROM raw_game_set_${index.toString()}`,
    )
    .join(" UNION ALL ");
  const eligible = frag(
    `eligible_matches AS (SELECT match_id, MIN(game_end_at) AS game_end_at FROM (${eligibleUnion}) GROUP BY match_id ORDER BY game_end_at ASC, match_id ASC LIMIT ${input.plan.maxEligibleGames.toString()})`,
  );
  const finalSets = input.plan.gameSets.map((gameSet, index) =>
    frag(
      `game_set_${index.toString()} AS (SELECT raw.* FROM raw_game_set_${index.toString()} AS raw INNER JOIN eligible_matches AS eligible ON eligible.match_id = raw.match_id ORDER BY raw.game_end_at ASC, raw.match_id ASC LIMIT ${gameSet.limit.toString()})`,
    ),
  );
  const setIndex = new Map(
    input.plan.gameSets.map((gameSet, index) => [gameSet.name, index]),
  );
  const result = seq(
    "dare_result AS (SELECT ",
    resultFragment(input.plan.result, setIndex, input.plan),
    " AS achieved)",
  );
  const evidence = input.plan.gameSets
    .map(
      (gameSet, index) =>
        `SELECT '${gameSet.name}' AS game_set, match_id, game_end_at, matched FROM game_set_${index.toString()}`,
    )
    .join(" UNION ALL ");
  const coverageComplete = needsTimeline
    ? "NOT EXISTS (SELECT 1 FROM eligible_matches AS eligible LEFT JOIN timeline_coverage AS coverage ON coverage.match_id = eligible.match_id AND coverage.coverage_state = 'complete' WHERE coverage.match_id IS NULL)"
    : "TRUE";
  return seq(
    "WITH ",
    joinFragments(
      [...sources, ...rawSets, eligible, ...finalSets, result],
      ", ",
    ),
    ` SELECT dare_result.achieved, (SELECT COUNT(*) FROM eligible_matches) AS eligible_games, ${coverageComplete} AS coverage_complete, evidence.game_set, evidence.match_id, evidence.game_end_at, evidence.matched FROM dare_result LEFT JOIN (${evidence}) AS evidence ON TRUE ORDER BY evidence.game_end_at ASC NULLS LAST, evidence.match_id ASC NULLS LAST, evidence.game_set ASC NULLS LAST`,
  );
}
