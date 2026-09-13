/**
 * Shared configuration and boundary parsing for the PUUID key migration.
 *
 * See `scripts/migrate-puuid-key.ts` for what the migration is and why it
 * exists.
 */

import { z } from "zod";

const EnvSchema = z.object({
  OLD_RIOT_API_KEY: z.string().min(1),
  NEW_RIOT_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ACCOUNT_ROUTE: z.string().default("americas"),
});

export const env = EnvSchema.parse(Bun.env);

/**
 * The old key is personal-tier: 20 requests/second and 100 per 120 seconds.
 *
 * That budget is SHARED with live prod and beta traffic — both environments run
 * on this same key right now — so harvest deliberately claims only half of the
 * 2-minute window. Starving Scout's own prematch and postmatch polling to
 * finish a migration a few minutes sooner is a bad trade, and the tracked sets
 * are small enough (173 prod, 50 beta) that the slower pace costs little.
 */
export const OLD_KEY_LIMITS = { perSecond: 8, perTwoMinutes: 50 } as const;
export const NEW_KEY_LIMITS = { perSecond: 45, perTwoMinutes: 5000 } as const;

/** Tables the migration owns or must never rewrite. */
export const EXCLUDED_TABLES = new Set([
  "PuuidKeyMap",
  "_prisma_migrations",
  "sqlite_sequence",
]);

/**
 * Columns that hold PUUIDs but are not named for them, so name-based discovery
 * cannot find them. Every one of these was found by the completeness audit in
 * `collect` rather than by reading the schema — the PUUIDs are nested inside
 * JSON whose column name says nothing about them.
 *
 * Anything new that turns up is caught by that same audit, which fails the run
 * rather than guessing.
 */
export const EXTRA_JSON_COLUMNS: readonly {
  table: string;
  column: string;
}[] = [
  { table: "BucksDareTarget", column: "accounts" },
  { table: "BucksDareV2Target", column: "accounts" },
  { table: "BucksDareV2Revision", column: "targetsJson" },
  { table: "BucksDareV2", column: "contractJson" },
  { table: "BucksLedgerEntry", column: "context" },
  { table: "BucksMatchEarning", column: "targetSnapshotJson" },
  { table: "BucksMatchPool", column: "roster" },
  { table: "BucksParlayDefinition", column: "subjects" },
  { table: "BucksWeeklyParlayContribution", column: "snapshot" },
  { table: "BucksWeeklyParlayDefinition", column: "subjects" },
  { table: "BucksWeeklyParlayDefinition", column: "historySample" },
  { table: "ChallengeRunRevision", column: "selectedAccountsJson" },
  { table: "ExploreMessage", column: "preview" },
  { table: "ExploreMessage", column: "trace" },
  { table: "HallRecordCell", column: "holdersJson" },
  { table: "HallRecordCell", column: "evidenceJson" },
  { table: "ScoutInteractiveRun", column: "trace" },
  { table: "ScoutTemporalWork", column: "payload" },
];

/**
 * Where a TRACKED identity is registered.
 *
 * Only tracked players need re-domaining. Scout stores PUUIDs for every match
 * participant — opponents, premades, and people merely seen in a game — but
 * those are opaque strings we never resolve, join on, or show. Translating
 * them would mean thousands of extra Riot lookups against a 0.83 req/s budget
 * to repair identities nobody reads.
 *
 * `Account` is the authority: it is the registration table, and every
 * `ActiveGame.trackedPuuids` entry in prod is already a subset of it. The
 * other two are named for tracking and included as a safety net in case a
 * future schema registers a tracked account somewhere else first.
 *
 * Everything outside this set keeps its old-domain value. `collect` reports
 * how many that is rather than leaving it implicit.
 */
export const TRACKED_SOURCES: readonly {
  table: string;
  column: string;
  json: boolean;
}[] = [
  { table: "Account", column: "puuid", json: false },
  { table: "MatchTrackedAccount", column: "puuid", json: false },
  { table: "ActiveGame", column: "trackedPuuids", json: true },
];

/** Anything a driver will accept as a bound parameter. */
export type SqlParam = z.infer<typeof SqlParamSchema>;

const SqlParamSchema = z.union([
  z.string(),
  z.number(),
  z.bigint(),
  z.boolean(),
  z.null(),
]);

export type Row = Record<string, unknown>;

const RowsSchema = z.array(z.record(z.string(), z.unknown()));

export function toRows(value: unknown): Row[] {
  return RowsSchema.parse(value);
}

export function asString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected string for ${what}, got ${typeof value}`);
  }
  return value;
}

export function asOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  throw new TypeError(`Expected a text value, got ${typeof value}`);
}

export function toSqlParam(value: unknown, what: string): SqlParam {
  const parsed = SqlParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `Cannot bind ${what}: unsupported type ${typeof value}`,
    );
  }
  return parsed.data;
}

export function asCount(value: unknown, what: string): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }
  throw new TypeError(`Expected a count for ${what}, got ${typeof value}`);
}

/** Reads the `n` column from a COUNT(*) result, tolerating an empty result. */
export function countOf(rows: readonly Row[], what: string): number {
  const first = rows[0];
  return first === undefined ? 0 : asCount(first["n"], what);
}

/**
 * Normalise a stored timestamp to epoch milliseconds.
 *
 * The same logical instant reaches us in three shapes: an integer of epoch
 * milliseconds (how the promoted SQLite image stores `createdTime`), a `Date`
 * (what the Postgres driver returns), and text (what SQLite's `datetime()`
 * writes). Comparing those in SQL is not just imprecise, it is wrong — SQLite
 * orders every integer before every text value, so an integer timestamp
 * compares as smaller than ANY text timestamp regardless of the dates. Any
 * ordering has to happen here, after both sides are the same kind of number.
 */
export function toEpochMillis(value: unknown, what: string): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    // SQLite's datetime() yields "YYYY-MM-DD HH:MM:SS" in UTC with no zone
    // marker, which Date.parse would otherwise read as local time.
    const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
    const parsed = Date.parse(normalised);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  throw new TypeError(`Cannot read ${what} as a timestamp`);
}
