import {
  ACCOUNT_LAKE_COLUMNS,
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  PREDICTION_OBSERVATION_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "@scout-for-lol/data/model/lake-columns.ts";

export {
  ACCOUNT_LAKE_COLUMNS,
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  PREDICTION_OBSERVATION_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
} from "@scout-for-lol/data/model/lake-columns.ts";

/**
 * Backend-side helpers over the report-lake table schemas.
 *
 * The row schemas and column-type maps themselves live in
 * `@scout-for-lol/data` (`model/lake-columns.ts`) — the single source of
 * truth for lake column names and types, shared with the ScoutQL language
 * layer. This module holds what only the backend needs: row timestamp
 * producers, DuckDB SQL builders, and the schema fingerprint.
 *
 * Timestamps are naive-UTC strings ("YYYY-MM-DD HH:MM:SS.mmm") that DuckDB
 * reads as TIMESTAMP; query-side comparisons use epoch_ms() against bound
 * epoch-millis, sidestepping session-timezone semantics entirely.
 */

export function lakeTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace("Z", "");
}

/** Partition key: month of the row's primary timestamp, e.g. "2026-07". */
export function lakeMonth(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 7);
}

/**
 * Render a column-type map as the `columns={...}` argument for read_json.
 * Column names come from our own literals in `@scout-for-lol/data` (never
 * user input), so embedding them in SQL text is safe.
 */
export function duckDbColumnsSpec(
  columns: Record<string, DuckDbColumnType>,
): string {
  const entries = Object.entries(columns)
    .map(([name, type]) => `${name}: '${type}'`)
    .join(", ");
  return `{${entries}}`;
}

/** Build a typed empty relation for materializing a schema-only Parquet file. */
export function duckDbEmptySelect(
  columns: Record<string, DuckDbColumnType>,
): string {
  return `SELECT ${Object.entries(columns)
    .map(([name, type]) => `CAST(NULL AS ${type}) AS ${name}`)
    .join(", ")} WHERE FALSE`;
}

/**
 * Fingerprint of every lake table's column set, recorded in each build's
 * manifest so the fold tier can tell that the schema moved under it.
 *
 * This exists because a lake read does not degrade when files disagree on
 * columns — it fails outright. `buildUnionSource` selects an explicit column
 * list across the whole parquet file list, so a file missing a column raises
 * `Binder Error: Referenced column "x" not found` and takes down every report,
 * Explore answer, and ScoutQL query with it. The fold tier hardlinks the
 * previous build's parquet and appends only new fold files, so adding a column
 * publishes exactly that mixed build. Comparing fingerprints lets the fold fall
 * back to a full rebuild from S3, which rewrites every file at the new schema.
 *
 * `union_by_name=true` is deliberately NOT the fix: it fills missing columns
 * with NULL, so every aggregate over pre-rebuild rows would be silently wrong
 * instead of loudly broken.
 *
 * Column ORDER is not part of the fingerprint. Reads name their columns and
 * union by name, so a cosmetic reorder is read-compatible and should not cost a
 * full rebuild; a rename, addition, removal, or type change is not, and does.
 */
export function lakeSchemaFingerprint(): string {
  const tables: Record<string, Record<string, DuckDbColumnType>> = {
    matches: MATCH_LAKE_COLUMNS,
    prematch: PREMATCH_LAKE_COLUMNS,
    prediction_observations: PREDICTION_OBSERVATION_LAKE_COLUMNS,
    accounts: ACCOUNT_LAKE_COLUMNS,
    competition_rank_history: COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  };
  const hasher = new Bun.CryptoHasher("sha256");
  for (const [table, columns] of Object.entries(tables)) {
    const signature = Object.entries(columns)
      .map(([name, type]) => `${name}:${type}`)
      .sort()
      .join(",");
    hasher.update(`${table}=${signature}\n`);
  }
  return hasher.digest("hex").slice(0, 16);
}
