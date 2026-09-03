import { z } from "zod";
import {
  DARE_SQL_V3_COMPILER_VERSION,
  DARE_V2_MAX_ELIGIBLE_GAMES,
  DareSqlV3CompilationSchema,
  DareSqlV3EvidenceSchema,
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
  type DareSqlV3Compilation,
  type DareSqlV3Evidence,
  type DareTargetBindingV2,
  type DuckDbColumnType,
} from "@scout-for-lol/data";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { duckDbEmptySelect } from "#src/report-lake/schema.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  buildMatchTeamBansSource,
  buildMatchTeamsSource,
  buildTimelineCoverageSource,
  buildTimelineEventParticipantsSource,
  buildTimelineEventsSource,
  buildTimelineParticipantFramesSource,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import { validateDareSqlV3 } from "#src/reports/duckdb/relational-scoutql.ts";
import {
  dareSqlV3CteTargetDependenciesFromAst,
  dareSqlV3FinalityFromAst,
  dareSqlV3ResultStructureFromAst,
} from "#src/betting/dare-sql-v3-finality.ts";

const RootRowSchema = z.strictObject({ achieved: z.boolean().nullable() });
const MatchIdRowSchema = z.strictObject({ match_id: z.string() });
const CoverageRowSchema = z.strictObject({
  missing: z.bigint().or(z.number()),
});
const SqlRowSchema = z.strictObject({ sql: z.string() });
const AstTextRowSchema = z.strictObject({ ast: z.string() });
const DescribeRowSchema = z
  .object({ column_name: z.string(), column_type: z.string() })
  .loose();
const GameSetRowSchema = z
  .object({
    match_id: z.string(),
    game_end_at: z.coerce.date(),
    matched: z.boolean().nullable(),
  })
  .loose();
const TARGET_KEY = /^T[1-5]$/u;
const COMPILE_RELATIONS = [
  ["match_participants", MATCH_LAKE_COLUMNS],
  ["matches", MATCH_LAKE_COLUMNS],
  ["match_teams", MATCH_TEAM_LAKE_COLUMNS],
  ["match_team_bans", MATCH_TEAM_BAN_LAKE_COLUMNS],
  ["timeline_events", TIMELINE_EVENT_LAKE_COLUMNS],
  ["timeline_event_participants", TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS],
  ["timeline_participant_frames", TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS],
  ["timeline_coverage", TIMELINE_COVERAGE_LAKE_COLUMNS],
] as const;

function bindParams(session: DuckDBSession, params: BoundParam[]) {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

async function verifiedCanonicalSql(
  session: DuckDBSession,
  compilation: DareSqlV3Compilation,
): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256")
    .update(compilation.immutableAst)
    .digest("hex");
  if (hash !== compilation.queryHash) {
    throw new Error("Dare SQL immutable AST does not match its query hash.");
  }
  const rows = await session.run(
    "SELECT json_deserialize_sql(CAST(? AS JSON)) AS sql",
    [compilation.immutableAst],
  );
  const canonicalSql = SqlRowSchema.parse(rows[0]).sql;
  const textRows = await session.run(
    "SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS ast",
    [compilation.canonicalSql],
  );
  const textHash = new Bun.CryptoHasher("sha256")
    .update(AstTextRowSchema.parse(textRows[0]).ast)
    .digest("hex");
  if (textHash !== compilation.queryHash) {
    throw new Error("Dare SQL text does not match its immutable AST.");
  }
  return canonicalSql;
}

function isNumericDuckDbType(columnType: string): boolean {
  const normalized = columnType.toUpperCase();
  return /(BIGINT|DECIMAL|DOUBLE|FLOAT|HUGEINT|INTEGER|NUMERIC|REAL|SMALLINT|TINYINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)/u.test(
    normalized,
  );
}

async function validateGameSetTypes(
  canonicalSql: string,
  gameSets: DareSqlV3Compilation["resultStructure"]["gameSets"],
  targetKeys: readonly string[],
): Promise<void> {
  if (gameSets.length === 0) return;
  const parts = rootQueryParts(canonicalSql);
  if (parts === null) {
    throw new Error("Dare SQL canonical root could not be separated.");
  }
  await withDuckDBConnection(async (session) => {
    for (const [relation, columns] of COMPILE_RELATIONS) {
      await session.run(
        `CREATE TEMP TABLE ${relation} AS ${duckDbEmptySelect(columns)}`,
      );
    }
    for (const targetKey of targetKeys) {
      await session.run(
        `CREATE TEMP TABLE ${targetKey} AS ${duckDbEmptySelect(MATCH_LAKE_COLUMNS)}`,
      );
    }
    for (const gameSet of gameSets) {
      const rows = await session.run(
        `DESCRIBE SELECT * FROM (${parts.prefix}SELECT * FROM ${gameSet.name}) AS _dare_game_set`,
      );
      const columns = new Map(
        rows.map((row) => {
          const parsed = DescribeRowSchema.parse(row);
          return [parsed.column_name.toLowerCase(), parsed.column_type];
        }),
      );
      const matchIdType = columns.get("match_id");
      const gameEndType = columns.get("game_end_at");
      const matchedType = columns.get("matched");
      if (matchIdType !== "VARCHAR") {
        throw new Error(
          `Dare SQL game set ${gameSet.name} match_id must be VARCHAR, got ${matchIdType ?? "missing"}.`,
        );
      }
      if (gameEndType !== "TIMESTAMP") {
        throw new Error(
          `Dare SQL game set ${gameSet.name} game_end_at must be TIMESTAMP, got ${gameEndType ?? "missing"}.`,
        );
      }
      if (matchedType !== "BOOLEAN") {
        throw new Error(
          `Dare SQL game set ${gameSet.name} matched must be BOOLEAN, got ${matchedType ?? "missing"}.`,
        );
      }
      for (const projection of gameSet.projectionColumns) {
        const projectionType = columns.get(projection.toLowerCase());
        if (
          projectionType === undefined ||
          !isNumericDuckDbType(projectionType)
        ) {
          throw new Error(
            `Dare SQL game set ${gameSet.name} projection ${projection} must be numeric, got ${projectionType ?? "missing"}.`,
          );
        }
      }
    }
  });
}

export async function compileDareSqlV3(input: {
  queryText: string;
  targetKeys: readonly string[];
}): Promise<DareSqlV3Compilation> {
  const invalidKey = input.targetKeys.find((key) => !TARGET_KEY.test(key));
  if (invalidKey !== undefined) {
    throw new Error(`Dare SQL target key ${invalidKey} must be T1 through T5.`);
  }
  const validated = await validateDareSqlV3({
    queryText: input.queryText,
    allowedTargetKeys: input.targetKeys,
  });
  if (validated.kind === "invalid") {
    throw new Error(validated.issues.join(" "));
  }
  const compilation = DareSqlV3CompilationSchema.parse({
    compilerVersion: DARE_SQL_V3_COMPILER_VERSION,
    canonicalSql: validated.compilation.canonicalScoutQl,
    immutableAst: validated.compilation.immutableAst,
    queryHash: validated.compilation.planHash,
    maxEligibleGames: DARE_V2_MAX_ELIGIBLE_GAMES,
    facts: validated.compilation.facts,
    resultStructure: dareSqlV3ResultStructureFromAst(
      validated.compilation.immutableAst,
      input.targetKeys,
    ),
    finality: dareSqlV3FinalityFromAst(validated.compilation.immutableAst),
  });
  await validateGameSetTypes(
    compilation.canonicalSql,
    compilation.resultStructure.gameSets,
    input.targetKeys,
  );
  return compilation;
}

async function materialize(
  session: DuckDBSession,
  table: string,
  source: SqlFragment | undefined,
  columns: Record<string, DuckDbColumnType>,
): Promise<void> {
  const body = source?.sql ?? duckDbEmptySelect(columns);
  await session.run(
    `CREATE TEMP TABLE ${table} AS ${body}`,
    source === undefined ? [] : bindParams(session, source.params),
  );
}

function targetPredicate(target: DareTargetBindingV2): SqlFragment {
  const clauses: string[] = [];
  const params: BoundParam[] = [];
  for (const account of target.accounts) {
    clauses.push("(puuid = ? AND epoch_ms(game_end_at) >= ?)");
    params.push(
      scalarParam(account.puuid),
      scalarParam(new Date(account.trackingStartedAt).getTime()),
    );
  }
  return { sql: clauses.join(" OR "), params };
}

async function createTargetRelations(
  session: DuckDBSession,
  targets: readonly DareTargetBindingV2[],
): Promise<void> {
  for (const target of targets) {
    if (!TARGET_KEY.test(target.key)) {
      throw new Error(
        `Dare SQL target key ${target.key} must be T1 through T5.`,
      );
    }
    const predicate = targetPredicate(target);
    await session.run(
      `CREATE TEMP TABLE ${target.key} AS SELECT * FROM match_participants WHERE ${predicate.sql}`,
      bindParams(session, predicate.params),
    );
  }
}

async function createLakeRelations(
  session: DuckDBSession,
  input: {
    targets: readonly DareTargetBindingV2[];
    start: Date;
    end: Date;
    lakeDir: string;
    maxEligibleGames: number;
  },
): Promise<void> {
  const files = await resolveLakeFiles(input.lakeDir);
  const windowPredicate = {
    sql: "queue IS NOT NULL AND epoch_ms(game_start_at) >= ? AND epoch_ms(game_end_at) BETWEEN ? AND ?",
    params: [
      scalarParam(input.start.getTime()),
      scalarParam(input.start.getTime()),
      scalarParam(input.end.getTime()),
    ],
  };
  await materialize(
    session,
    "_dare_match_window",
    buildMatchesSource(files, windowPredicate),
    MATCH_LAKE_COLUMNS,
  );
  const allTargetAccounts = input.targets.flatMap((target) => target.accounts);
  const targetMembership = allTargetAccounts.map(
    () => "(puuid = ? AND epoch_ms(game_end_at) >= ?)",
  );
  const targetParams = allTargetAccounts.flatMap((account) => [
    scalarParam(account.puuid),
    scalarParam(new Date(account.trackingStartedAt).getTime()),
  ]);
  await session.run(
    `CREATE TEMP TABLE _dare_match_ids AS
     SELECT match_id
     FROM _dare_match_window
     WHERE ${targetMembership.join(" OR ")}
     GROUP BY match_id
     HAVING SUM(CASE WHEN end_of_game_result = 'GameComplete'
       AND game_duration_seconds >= 300
       AND NOT game_ended_in_early_surrender
       AND NOT team_early_surrendered
       THEN 0 ELSE 1 END) = 0
     ORDER BY MIN(game_end_at), match_id
     LIMIT ?`,
    bindParams(session, [...targetParams, scalarParam(input.maxEligibleGames)]),
  );
  await session.run(
    "CREATE TEMP TABLE match_participants AS SELECT * FROM _dare_match_window WHERE match_id IN (SELECT match_id FROM _dare_match_ids)",
  );
  await session.run(
    "CREATE TEMP VIEW matches AS SELECT DISTINCT match_id, game_id, platform_id, month, game_creation_at, game_start_at, game_end_at, game_duration_seconds, queue_id, queue, game_mode, game_type, game_version, end_of_game_result, map_id FROM match_participants",
  );
  const matchFilter = {
    sql: "match_id IN (SELECT match_id FROM _dare_match_ids)",
    params: [],
  };
  await materialize(
    session,
    "match_teams",
    buildMatchTeamsSource(files, matchFilter),
    MATCH_TEAM_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "match_team_bans",
    buildMatchTeamBansSource(files, matchFilter),
    MATCH_TEAM_BAN_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "timeline_events",
    buildTimelineEventsSource(files, matchFilter),
    TIMELINE_EVENT_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "timeline_event_participants",
    buildTimelineEventParticipantsSource(files, matchFilter),
    TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "timeline_participant_frames",
    buildTimelineParticipantFramesSource(files, matchFilter),
    TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "timeline_coverage",
    buildTimelineCoverageSource(files, matchFilter),
    TIMELINE_COVERAGE_LAKE_COLUMNS,
  );
  await createTargetRelations(session, input.targets);
}

function numericProjection(value: unknown, column: string): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint" && Number.isSafeInteger(Number(value))) {
    return Number(value);
  }
  throw new Error(`Dare SQL projection ${column} must be numeric or NULL.`);
}

async function executeGameSetRows(
  session: DuckDBSession,
  compilation: DareSqlV3Compilation,
) {
  const parts = rootQueryParts(compilation.canonicalSql);
  if (parts === null && compilation.resultStructure.gameSets.length > 0) {
    throw new Error("Dare SQL canonical root could not be separated.");
  }
  if (parts === null) return [];
  const results: DareSqlV3Evidence["results"] = [];
  for (const gameSet of compilation.resultStructure.gameSets) {
    const columns = gameSet.projectionColumns.map((column) => `, ${column}`);
    const rows = await session.run(
      `${parts.prefix}SELECT match_id, game_end_at, matched${columns.join("")} FROM ${gameSet.name} ORDER BY game_end_at, match_id`,
    );
    for (const raw of rows) {
      const row = GameSetRowSchema.parse(raw);
      const projections: Record<string, number | null> = {};
      for (const column of gameSet.projectionColumns) {
        projections[column] = numericProjection(row[column], column);
      }
      results.push({
        gameSet: gameSet.name,
        matchId: row.match_id,
        gameEndAt: row.game_end_at.toISOString(),
        matched: row.matched,
        projections,
        targetDependencies:
          gameSet.targetDependencies.length > 0
            ? gameSet.targetDependencies
            : compilation.facts.targetKeys,
      });
    }
  }
  return results;
}

export async function executeDareSqlV3(input: {
  compilation: DareSqlV3Compilation;
  targets: readonly DareTargetBindingV2[];
  start: Date;
  end: Date;
  lakeDir?: string | undefined;
}): Promise<DareSqlV3Evidence> {
  const compilation = DareSqlV3CompilationSchema.parse(input.compilation);
  return await withDuckDBConnection(async (session) => {
    const canonicalSql = await verifiedCanonicalSql(session, compilation);
    await createLakeRelations(session, {
      targets: input.targets,
      start: input.start,
      end: input.end,
      lakeDir: input.lakeDir ?? resolveLakeDir(),
      maxEligibleGames: compilation.maxEligibleGames,
    });
    const resultRows = await session.run(canonicalSql);
    if (resultRows.length !== 1) {
      throw new Error("Dare SQL root query must return exactly one row.");
    }
    const result = RootRowSchema.parse(resultRows[0]);
    const results = await executeGameSetRows(session, compilation);
    const matchRows = await session.run(
      "SELECT i.match_id FROM _dare_match_ids AS i JOIN matches AS m USING (match_id) ORDER BY m.game_end_at, i.match_id",
    );
    const sourceMatchIds = matchRows.map(
      (row) => MatchIdRowSchema.parse(row).match_id,
    );
    const needsTimeline = compilation.facts.physicalSources.some((source) =>
      source.startsWith("timeline_"),
    );
    let coverage: "complete" | "missing_timeline" | "not_required" =
      "not_required";
    if (needsTimeline) {
      const coverageRows = await session.run(
        "SELECT COUNT(*)::BIGINT AS missing FROM _dare_match_ids AS m LEFT JOIN timeline_coverage AS c USING (match_id) WHERE c.match_id IS NULL",
      );
      coverage =
        Number(CoverageRowSchema.parse(coverageRows[0]).missing) === 0
          ? "complete"
          : "missing_timeline";
    }
    return DareSqlV3EvidenceSchema.parse({
      achieved: coverage === "missing_timeline" ? null : result.achieved,
      results,
      targetDependencies: compilation.facts.targetKeys,
      coverage,
      sourceMatchIds,
      queryHash: compilation.queryHash,
    });
  });
}

function outerParenthesesWrap(expression: string): boolean {
  let depth = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && index < expression.length - 1) return false;
  }
  return true;
}

function stripOuterParentheses(expression: string): string {
  let current = expression.trim();
  while (
    current.startsWith("(") &&
    current.endsWith(")") &&
    outerParenthesesWrap(current)
  ) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function topLevelOrBranches(expression: string): string[] {
  const normalized = stripOuterParentheses(expression);
  const branches: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (
      depth === 0 &&
      normalized.slice(index, index + 4).toUpperCase() === " OR "
    ) {
      branches.push(normalized.slice(start, index).trim());
      start = index + 4;
      index += 3;
    }
  }
  branches.push(normalized.slice(start).trim());
  return branches;
}

function rootQueryParts(canonicalSql: string) {
  const lower = canonicalSql.toLowerCase();
  let depth = 0;
  let selectIndex = -1;
  for (let index = 0; index < lower.length; index += 1) {
    const character = lower[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && lower.slice(index, index + 7) === "select ") {
      selectIndex = index;
    }
  }
  const achievedIndex = lower.lastIndexOf(" as achieved");
  if (selectIndex < 0 || achievedIndex <= selectIndex) return null;
  return {
    prefix: canonicalSql.slice(0, selectIndex),
    expression: canonicalSql.slice(
      selectIndex + "select ".length,
      achievedIndex,
    ),
  };
}

function targetDependenciesIn(text: string, targetKeys: readonly string[]) {
  return targetKeys.filter((key) =>
    new RegExp(String.raw`\b${key}\b`, "iu").test(text),
  );
}

/**
 * Preserve v2's decisive-branch payout rule for an ordinary SQL OR. The SQL
 * remains authoritative: each root branch is executed as a scalar Boolean,
 * then the first true branch in canonical order supplies its target lineage.
 * More complex Boolean shapes conservatively retain every dependency.
 */
export async function decisiveTargetDependenciesV3(input: {
  compilation: DareSqlV3Compilation;
  targets: readonly DareTargetBindingV2[];
  start: Date;
  end: Date;
  lakeDir?: string | undefined;
}): Promise<string[]> {
  const parts = rootQueryParts(input.compilation.canonicalSql);
  if (parts === null) return input.compilation.facts.targetKeys;
  const branches = topLevelOrBranches(parts.expression);
  if (branches.length < 2) return input.compilation.facts.targetKeys;
  const cteTargetDependencies = dareSqlV3CteTargetDependenciesFromAst(
    input.compilation.immutableAst,
    input.compilation.facts.targetKeys,
  );
  for (const branch of branches) {
    const branchTargetKeys = targetDependenciesIn(
      `${parts.prefix} ${branch}`,
      input.compilation.facts.targetKeys,
    );
    const compilation = await compileDareSqlV3({
      queryText: `${parts.prefix}SELECT (${branch}) = TRUE AS achieved`,
      targetKeys:
        branchTargetKeys.length > 0
          ? branchTargetKeys
          : input.targets.map((target) => target.key),
    });
    const evidence = await executeDareSqlV3({
      compilation,
      targets: input.targets,
      start: input.start,
      end: input.end,
      ...(input.lakeDir === undefined ? {} : { lakeDir: input.lakeDir }),
    });
    if (evidence.achieved === true) {
      const direct = targetDependenciesIn(
        branch,
        input.compilation.facts.targetKeys,
      );
      if (direct.length > 0) return direct;
      const inherited = [...cteTargetDependencies.entries()]
        .filter(([name]) =>
          new RegExp(String.raw`\b${name}\b`, "iu").test(branch),
        )
        .flatMap(([, dependencies]) => dependencies)
        .toSorted()
        .filter((key, index, keys) => keys[index - 1] !== key);
      return inherited.length > 0
        ? inherited
        : input.compilation.facts.targetKeys;
    }
  }
  return input.compilation.facts.targetKeys;
}
