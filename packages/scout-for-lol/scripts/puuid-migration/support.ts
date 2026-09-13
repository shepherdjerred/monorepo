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
  { table: "BucksDareV2Activation", column: "snapshotJson" },
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
  { table: "ConfirmationIntent", column: "payload" },
  { table: "ExploreMessage", column: "preview" },
  { table: "ExploreMessage", column: "trace" },
  { table: "HallRecordCell", column: "holdersJson" },
  { table: "HallRecordCell", column: "evidenceJson" },
  { table: "ScoutInteractiveRun", column: "trace" },
  { table: "ScoutTemporalWork", column: "payload" },
];

type TrackedSource = {
  table: string;
  column: string;
  json: boolean;
  bareArray: boolean;
  createdColumn: string;
  /**
   * Restricts which rows count as a source. A column can be both a source and
   * an archive depending on row state — queued work still has an identity that
   * will be acted on, while completed work is only a record of what happened.
   */
  where?: string;
  /**
   * Restricts which part of a JSON document counts. Needed where one payload
   * mixes identities that will be acted on with identities that were merely
   * observed, so that collecting the document whole would sweep in strangers.
   */
  jsonPath?: string;
};

const scalar = (
  table: string,
  column: string,
  createdColumn: string,
): TrackedSource => ({
  table,
  column,
  json: false,
  bareArray: false,
  createdColumn,
});

const bareArrayJson = (
  table: string,
  column: string,
  createdColumn: string,
): TrackedSource => ({
  table,
  column,
  json: true,
  bareArray: true,
  createdColumn,
});

const objectJson = (
  table: string,
  column: string,
  createdColumn: string,
): TrackedSource => ({
  table,
  column,
  json: true,
  bareArray: false,
  createdColumn,
});

/**
 * Columns whose identities are NOT migrated.
 *
 * Everything else that holds a PUUID is a tracked source. That default is
 * deliberate and was learned the hard way: a column left out of collection is
 * left in the old domain, and nothing fails loudly — an unmigrated Dare target
 * simply never matches a participant again, an unmigrated duel member silently
 * breaks lobby provisioning. Omissions are silent, so the list that has to be
 * right is the short one, and each entry here states why it is safe.
 *
 * What these share is that they record who was *seen*, not who is *watched*:
 * they carry every participant of a game, including opponents Scout never
 * tracked, and nothing compares them against live match data afterwards. They
 * are still rewritten — a mapped identity is translated wherever it appears —
 * they are just not a reason to migrate an identity in the first place.
 */
export const ARCHIVE_COLUMNS: readonly { table: string; column: string }[] = [
  // Full match rosters: ten participants per game, mostly strangers.
  { table: "BucksMatchPool", column: "roster" },
  // Ledger and settlement records, written once and read for history.
  { table: "BucksLedgerEntry", column: "context" },
  { table: "BucksMatchEarning", column: "targetSnapshotJson" },
  // Stored query results, which can name any participant a query returned.
  { table: "ExploreMessage", column: "preview" },
  { table: "ExploreMessage", column: "trace" },
  { table: "ScoutInteractiveRun", column: "trace" },
];

/**
 * Where a tracked identity can live, and how to read and date it.
 *
 * Two kinds of source sit here together. Registration says who Scout watches
 * now. Frozen rosters — Dares, challenges, parlays, duels — pin their subjects
 * at creation and keep matching them against live games long afterwards, so
 * those PUUIDs stay load-bearing even once the account row is gone.
 *
 * Every entry needs a timestamp: an identity datable from no source at all
 * cannot be judged against the cutover, so it is held as suspect and fails
 * verification rather than being quietly excused.
 */
export const TRACKED_SOURCES: readonly TrackedSource[] = [
  scalar("Account", "puuid", "createdTime"),
  scalar("MatchTrackedAccount", "puuid", "createdAt"),
  scalar("MatchRankHistory", "puuid", "capturedAt"),
  scalar("CurrentRankSnapshot", "puuid", "createdAt"),
  scalar("BucksBet", "subjectPuuid", "createdAt"),
  scalar("ChallengeRunEvidence", "puuid", "createdAt"),
  scalar("ChallengeRunCursor", "puuid", "updatedAt"),
  scalar("DuelCompetitorMember", "puuid", "createdAt"),
  scalar("CustomGameParticipant", "puuid", "createdAt"),
  scalar("SummonerIndex", "puuid", "createdTime"),
  scalar("InitialMatchHistoryImport", "puuid", "createdAt"),
  bareArrayJson("ActiveGame", "trackedPuuids", "detectedAt"),
  bareArrayJson("TournamentLobby", "bluePuuids", "createdAt"),
  bareArrayJson("TournamentLobby", "redPuuids", "createdAt"),
  bareArrayJson("TournamentLobby", "joinedPuuids", "createdAt"),
  objectJson("BucksDareTarget", "accounts", "createdAt"),
  objectJson("BucksDareV2Target", "accounts", "createdAt"),
  objectJson("BucksDareV2Revision", "targetsJson", "createdAt"),
  // A rank Dare's activation snapshot freezes the account whose rank is the
  // baseline, under `sourcePuuid`. Settlement compares live results against it
  // for the life of the contract, so it stays load-bearing long after the
  // snapshot was taken.
  objectJson("BucksDareV2Activation", "snapshotJson", "createdAt"),
  objectJson("BucksDareV2", "contractJson", "createdAt"),
  objectJson("ChallengeRunRevision", "selectedAccountsJson", "createdAt"),
  // An unconsumed intent is an instruction that has not run yet, and its
  // identity is frozen at prepare time and deliberately never re-resolved at
  // confirm — see the note on `puuid` in
  // `@scout-for-lol/data`'s confirmation-intent model. Confirming one after the
  // cutover would replay a stale identifier straight into a new account the new
  // key cannot use. Expired-but-unconsumed rows are included rather than
  // excluded by a time predicate: they cost a handful of extra lookups, and a
  // row that expires between collect and apply would otherwise change category
  // mid-run.
  {
    ...objectJson("ConfirmationIntent", "payload", "createdAt"),
    where: `"consumedAt" IS NULL`,
  },
  objectJson("BucksParlayDefinition", "subjects", "createdAt"),
  objectJson("BucksWeeklyParlayDefinition", "subjects", "openAt"),
  objectJson("BucksWeeklyParlayDefinition", "historySample", "openAt"),
  objectJson("BucksWeeklyParlayContribution", "snapshot", "createdAt"),
  objectJson("HallRecordCell", "holdersJson", "createdAt"),
  objectJson("HallRecordCell", "evidenceJson", "createdAt"),
  // Unfinished work only. A failed row is requeueable — `work-store` moves it
  // back to `queued` — so its payload is an instruction that will still be
  // carried out, and the identity inside it gets written into whatever that run
  // produces. A completed row is only a record, and the payloads are whole match
  // documents full of opponents, so collecting those would pull the entire
  // corpus back in.
  {
    ...objectJson("ScoutTemporalWork", "payload", "createdAt"),
    where: `"state" <> 'completed'`,
    // Only the players the job will act on. The rest of the payload is the game
    // it describes — full participant lists, overwhelmingly strangers. On beta
    // that is the difference between 16 identities and 245, and any one of those
    // strangers failing to resolve would block the rewrite.
    jsonPath: "trackedPlayers",
  },
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
