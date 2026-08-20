import { match } from "ts-pattern";
import { z } from "zod";
import { requireReportChampion } from "#src/model/report-query-champions.ts";
import { UNSUPPORTED_WHERE_MESSAGE } from "#src/model/report-query-parser.ts";
import {
  ReportFilterFieldSchema,
  ReportFilterOperatorSchema,
  ReportFilterValueSchema,
  type ReportFilter,
  type ReportQueryPlan,
  type ReportWhereClause,
} from "#src/model/report-query-spec.ts";

const PositiveIntSchema = z.coerce.number().int().positive();

export type ReportWhereFilters = {
  queueFilter?: string[];
  championId?: number;
  minGames?: number;
  competitionId?: number;
  lookbackDays?: number;
  /** Names from `player('…')`, still unresolved — see the plan's player_ref. */
  playerRefs?: string[];
  filters: ReportFilter[];
};

export function compileReportWhere(
  clauses: ReportWhereClause[],
  source: ReportQueryPlan["source"],
): ReportWhereFilters {
  const filters: ReportWhereFilters = { filters: [] };
  for (const clause of clauses) {
    match(clause)
      .with({ kind: "unsupported" }, () => {
        throw new Error(UNSUPPORTED_WHERE_MESSAGE);
      })
      .with({ kind: "queue" }, (value) => {
        filters.queueFilter = value.values;
      })
      .with({ kind: "champion_id" }, (value) => {
        filters.championId = PositiveIntSchema.parse(value.value);
      })
      .with({ kind: "champion" }, (value) => {
        filters.championId = requireReportChampion(value.name).id;
      })
      .with({ kind: "player_ref" }, (value) => {
        // One row belongs to exactly one account, so `player = player('A') AND
        // player = player('B')` can never match. Collecting both into a set
        // would compile to `puuid IN (A, B)` — an OR, answering a question the
        // author did not ask.
        if (filters.playerRefs !== undefined) {
          throw new Error(
            "A query can name one player. `player = player('A') AND player = player('B')` matches no rows, because a row belongs to one account.",
          );
        }
        filters.playerRefs = [value.name];
      })
      .with({ kind: "lookback" }, (value) => {
        const expectedField =
          source === "prematch_participants"
            ? "observed_at"
            : "game_creation_at";
        if (value.field !== expectedField) {
          throw new Error(
            `Source "${source}" uses ${expectedField} for lookback filters, not ${value.field}.`,
          );
        }
        filters.lookbackDays = value.days;
      })
      .with({ kind: "min_games" }, (value) => {
        filters.minGames = PositiveIntSchema.parse(value.value);
      })
      .with({ kind: "competition_id" }, (value) => {
        filters.competitionId = PositiveIntSchema.parse(value.value);
      })
      .with({ kind: "field" }, (value) => {
        const filter: ReportFilter = {
          field: ReportFilterFieldSchema.parse(value.field),
          operator: ReportFilterOperatorSchema.parse(value.operator),
          values: value.values.map((item) =>
            ReportFilterValueSchema.parse(item),
          ),
        };
        validateFilter(filter);
        filters.filters.push(filter);
      })
      .exhaustive();
  }
  return filters;
}

const STRING_FILTERS = new Set([
  "player",
  "queue",
  "team_position",
  "individual_position",
  "lane",
  "role",
  "game_mode",
  "game_type",
  "game_version",
]);
const BOOLEAN_FILTERS = new Set([
  "win",
  "surrendered",
  "early_surrendered",
  "first_blood_kill",
]);

function validateFilter(filter: ReportFilter): void {
  if (filter.values.length === 0) {
    throw new Error(`Filter ${filter.field} requires at least one value.`);
  }
  const supportsOrdering =
    !STRING_FILTERS.has(filter.field) && !BOOLEAN_FILTERS.has(filter.field);
  if (
    !supportsOrdering &&
    filter.operator !== "=" &&
    filter.operator !== "!=" &&
    filter.operator !== "in"
  ) {
    throw new Error(`Filter ${filter.field} only supports =, !=, and IN.`);
  }
  const expected = STRING_FILTERS.has(filter.field)
    ? "string"
    : BOOLEAN_FILTERS.has(filter.field)
      ? "boolean"
      : "number";
  if (filter.values.some((value) => typeof value !== expected)) {
    throw new Error(`Filter ${filter.field} requires ${expected} values.`);
  }
  if (filter.operator !== "in" && filter.values.length !== 1) {
    throw new Error(`Filter ${filter.field} requires exactly one value.`);
  }
}
