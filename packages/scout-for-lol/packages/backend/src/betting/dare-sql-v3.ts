import { z } from "zod";
import { dareSqlV3DomainIssues } from "#src/betting/dare-sql-v3-domains.ts";
import {
  DARE_SQL_V3_COMPILER_VERSION,
  DARE_V2_MAX_ELIGIBLE_GAMES,
  DareSqlV3CompilationSchema,
  DareSqlV3EvidenceSchema,
  type DareSqlV3Compilation,
  type DareSqlV3Competition,
  type DareActivationV3,
  type DareSqlV3Evidence,
  type DareTargetBindingV2,
} from "@scout-for-lol/data";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import { validateDareSqlV3 } from "#src/reports/duckdb/relational-scoutql.ts";
import {
  dareSqlV3FinalityFromAst,
  dareSqlV3ResultStructureFromAst,
  validateDareSqlV3RaceRootFromAst,
} from "#src/betting/dare-sql-v3-finality.ts";
import {
  createDareSqlV3LakeRelations,
  dareSqlV3ComparesOpponentTeams,
} from "#src/betting/dare-sql-v3-lake.ts";
import { relevantDareTimelineEvents } from "#src/betting/dare-sql-v3-evidence.ts";
import { dareSqlV3CteTargetDependencies } from "#src/betting/dare-sql-v3-lineage.ts";

const RootRowSchema = z.strictObject({ achieved: z.boolean().nullable() });
const MatchIdRowSchema = z.strictObject({ match_id: z.string() });
const CoverageRowSchema = z.strictObject({
  missing: z.bigint().or(z.number()),
});
const SqlRowSchema = z.strictObject({ sql: z.string() });
const AstTextRowSchema = z.strictObject({ ast: z.string() });
const GameSetRowSchema = z
  .object({
    match_id: z.string(),
    game_end_at: z.coerce.date(),
    matched: z.boolean().nullable(),
  })
  .loose();
const TARGET_KEY = /^T[1-5]$/u;

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

export async function compileDareSqlV3(input: {
  queryText: string;
  targetKeys: readonly string[];
  competition?: DareSqlV3Competition | undefined;
  activation?: DareActivationV3 | undefined;
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
  // The frozen SQL is the contract, so an out-of-domain literal has to be
  // refused here: v3 keeps no typed plan for darePlanSemanticIssues to inspect,
  // and an unsatisfiable comparison would otherwise settle as a real loss.
  const domainIssues = dareSqlV3DomainIssues(
    validated.compilation.immutableAst,
  );
  if (domainIssues.length > 0) {
    throw new Error(domainIssues.join(" "));
  }
  const resultStructure = dareSqlV3ResultStructureFromAst(
    validated.compilation.immutableAst,
    input.targetKeys,
  );
  validateCompetition(input.competition ?? { kind: "standard" }, {
    targetKeys: input.targetKeys,
    gameSets: resultStructure.gameSets,
    immutableAst: validated.compilation.immutableAst,
  });
  validateActivation(input.activation ?? { kind: "immediate" }, {
    targetKeys: input.targetKeys,
    gameSets: resultStructure.gameSets,
    competition: input.competition ?? { kind: "standard" },
  });
  return DareSqlV3CompilationSchema.parse({
    compilerVersion: DARE_SQL_V3_COMPILER_VERSION,
    canonicalSql: validated.compilation.canonicalScoutQl,
    immutableAst: validated.compilation.immutableAst,
    queryHash: validated.compilation.planHash,
    maxEligibleGames: DARE_V2_MAX_ELIGIBLE_GAMES,
    facts: validated.compilation.facts,
    resultStructure,
    finality: dareSqlV3FinalityFromAst(validated.compilation.immutableAst),
    competition: input.competition ?? { kind: "standard" },
    activation: input.activation ?? { kind: "immediate" },
  });
}

function validateActivation(
  activation: DareActivationV3,
  input: {
    targetKeys: readonly string[];
    gameSets: DareSqlV3Compilation["resultStructure"]["gameSets"];
    competition: DareSqlV3Competition;
  },
): void {
  if (activation.kind === "immediate") return;
  if (input.competition.kind !== "standard") {
    throw new Error(
      "Race contracts cannot also use rank or improvement activation.",
    );
  }
  if (activation.kind === "rank") return;
  if (
    input.targetKeys.length !== 1 ||
    input.targetKeys[0] !== activation.targetKey
  ) {
    throw new Error(
      "An improvement contract must bind exactly its one target.",
    );
  }
  const gameSet = input.gameSets.find(
    (candidate) => candidate.name === activation.gameSet,
  );
  if (gameSet === undefined) {
    throw new Error(
      `Improvement baseline ${activation.gameSet} is not a game-set CTE.`,
    );
  }
  if (!gameSet.projectionColumns.includes(activation.projection)) {
    throw new Error(
      `Improvement baseline projection ${activation.projection} is not emitted by ${activation.gameSet}.`,
    );
  }
}

function validateCompetition(
  competition: DareSqlV3Competition,
  input: {
    targetKeys: readonly string[];
    gameSets: DareSqlV3Compilation["resultStructure"]["gameSets"];
    immutableAst: string;
  },
): void {
  if (competition.kind === "standard") return;
  const laneTargets = competition.lanes.map((lane) => lane.targetKey);
  const laneSets = competition.lanes.map((lane) => lane.gameSet);
  if (
    new Set(laneTargets).size !== laneTargets.length ||
    new Set(laneSets).size !== laneSets.length
  ) {
    throw new Error("Each race target and game set must appear exactly once.");
  }
  if (
    laneTargets.toSorted().join("|") !== input.targetKeys.toSorted().join("|")
  ) {
    throw new Error("A race must define exactly one lane for every target.");
  }
  for (const lane of competition.lanes) {
    const gameSet = input.gameSets.find(
      (candidate) => candidate.name === lane.gameSet,
    );
    if (gameSet === undefined) {
      throw new Error(`Race lane ${lane.gameSet} is not a game-set CTE.`);
    }
    if (
      gameSet.targetDependencies.length !== 1 ||
      gameSet.targetDependencies[0] !== lane.targetKey
    ) {
      throw new Error(
        `Race lane ${lane.gameSet} must depend only on ${lane.targetKey}.`,
      );
    }
  }
  validateDareSqlV3RaceRootFromAst(
    input.immutableAst,
    competition.lanes.map((lane) => lane.gameSet),
  );
}

export function dareSqlV3RaceEvidence(
  competition: DareSqlV3Competition,
  results: DareSqlV3Evidence["results"],
): DareSqlV3Evidence["race"] {
  if (competition.kind === "standard") return null;
  const finishes = competition.lanes.flatMap((lane) => {
    const first = results
      .filter(
        (result) => result.gameSet === lane.gameSet && result.matched === true,
      )
      .toSorted((left, right) => {
        const time = left.gameEndAt.localeCompare(right.gameEndAt);
        return time === 0 ? left.matchId.localeCompare(right.matchId) : time;
      })[0];
    return first === undefined
      ? []
      : [{ targetKey: lane.targetKey, gameEndAt: first.gameEndAt }];
  });
  const qualifyingGameEndAt = finishes
    .map((finish) => finish.gameEndAt)
    .toSorted()[0];
  return {
    leaders:
      qualifyingGameEndAt === undefined
        ? []
        : finishes
            .filter((finish) => finish.gameEndAt === qualifyingGameEndAt)
            .map((finish) => finish.targetKey)
            .toSorted(),
    qualifyingGameEndAt: qualifyingGameEndAt ?? null,
  };
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
  matchOrder?: "oldest" | "newest" | undefined;
}): Promise<DareSqlV3Evidence> {
  const compilation = DareSqlV3CompilationSchema.parse(input.compilation);
  return await withDuckDBConnection(async (session) => {
    const canonicalSql = await verifiedCanonicalSql(session, compilation);
    await createDareSqlV3LakeRelations(session, {
      targets: input.targets,
      start: input.start,
      end: input.end,
      lakeDir: input.lakeDir ?? resolveLakeDir(),
      maxEligibleGames: compilation.maxEligibleGames,
      excludeMultiTeamGames: dareSqlV3ComparesOpponentTeams(
        compilation.immutableAst,
      ),
      matchOrder: input.matchOrder ?? "oldest",
    });
    const resultRows = await session.run(canonicalSql);
    if (resultRows.length !== 1) {
      throw new Error("Dare SQL root query must return exactly one row.");
    }
    const result = RootRowSchema.parse(resultRows[0]);
    const results = await executeGameSetRows(session, compilation);
    const race = dareSqlV3RaceEvidence(compilation.competition, results);
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
    const timelineEvents = needsTimeline
      ? await relevantDareTimelineEvents(session, compilation)
      : [];
    const evaluatedAchievement =
      race === null ? result.achieved : race.leaders.length > 0;
    if (
      coverage !== "missing_timeline" &&
      result.achieved !== evaluatedAchievement
    ) {
      throw new Error(
        "Dare SQL race root must be true exactly when at least one lane qualifies.",
      );
    }
    return DareSqlV3EvidenceSchema.parse({
      achieved: coverage === "missing_timeline" ? null : evaluatedAchievement,
      results,
      targetDependencies:
        race === null || race.leaders.length === 0
          ? compilation.facts.targetKeys
          : race.leaders,
      coverage,
      sourceMatchIds,
      queryHash: compilation.queryHash,
      timelineEvents,
      race,
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
  for (const branch of branches) {
    const compilation = await compileDareSqlV3({
      queryText: `${parts.prefix}SELECT (${branch}) = TRUE AS achieved`,
      targetKeys: input.targets.map((target) => target.key),
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
      const inherited = dareSqlV3CteTargetDependencies(
        input.compilation.immutableAst,
        branch,
        input.compilation.facts.targetKeys,
      );
      if (inherited.length > 0) return [...new Set(inherited)].toSorted();
      throw new Error(
        "Could not establish decisive Dare target lineage from the immutable SQL AST.",
      );
    }
  }
  return input.compilation.facts.targetKeys;
}
