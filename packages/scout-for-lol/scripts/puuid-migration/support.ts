/**
 * Shared configuration and boundary parsing for the PUUID key migration.
 *
 * See `scripts/migrate-puuid-key.ts` for what the migration is and why it
 * exists.
 */

import { z } from "zod";

/**
 * Credentials, demanded one at a time by whoever actually needs them.
 *
 * Parsing every variable at import made importing a string helper require a
 * Riot key: an operator listing S3 had to invent an OLD_RIOT_API_KEY for a
 * command that never calls Riot. Worse, the failure named all three at once, so
 * a genuinely missing one was buried among two that did not matter.
 *
 * Each accessor names the one thing it needs and says which command needs it.
 */
function required(name: string, why: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set: ${why}`);
  }
  return value;
}

export const riotKeys = (): { old: string; fresh: string } => ({
  old: required("OLD_RIOT_API_KEY", "the key that minted the stored PUUIDs"),
  fresh: required("NEW_RIOT_API_KEY", "the key being migrated to"),
});

export const databaseUrl = (): string =>
  required("DATABASE_URL", "the database holding PuuidKeyMap");

/** Riot's account routing value. Regional for account-v1, so `americas` fits. */
export const accountRoute = (): string =>
  Bun.env["ACCOUNT_ROUTE"] ?? "americas";

/**
 * What each key publishes, measured from its own response headers.
 *
 * These are the BOOTSTRAP budget only: the limiter replaces them with whatever
 * the first live response reports, so a tier change corrects itself instead of
 * running for days at a silently wrong rate. They are recorded here so a run
 * starts at a sane rate before it has seen a header, and so the numbers below
 * are checkable against a real observation rather than folklore.
 *
 * Both were confirmed on 2026-09-13 against `account-v1`:
 *
 *   old key   app `100:120,20:1`     method `1000:60`   -> app binds at 0.83/s
 *   new key   app `500:10,30000:600` method `1000:60`   -> METHOD binds at 16.7/s
 *
 * The new key's method ceiling is the one that matters and is easy to miss: its
 * app limit would allow 50/s, and account-v1 will not.
 *
 * The old key no longer carries live traffic — both environments moved to the
 * production key — so the migration gets its whole budget. The production key
 * does still serve live polling, which is why the budget is a fraction of
 * published rather than all of it.
 */
export const OLD_KEY_PUBLISHED = {
  app: "100:120,20:1",
  method: "1000:60",
} as const;
export const NEW_KEY_PUBLISHED = {
  app: "500:10,30000:600",
  method: "1000:60",
} as const;

/** Tables the migration owns or must never rewrite. */
export const EXCLUDED_TABLES = new Set([
  "PuuidKeyMap",
  "PuuidKeyMigration",
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
  { table: "BucksDareGame", column: "snapshot" },
  { table: "BucksDareTarget", column: "accounts" },
  { table: "BucksDareV2Target", column: "accounts" },
  { table: "BucksDareV2Activation", column: "snapshotJson" },
  { table: "BucksDareV2Revision", column: "targetsJson" },
  { table: "BucksDareV2", column: "contractJson" },
  { table: "BucksLedgerEntry", column: "context" },
  { table: "BucksMatchEarning", column: "targetSnapshotJson" },
  { table: "BucksMatchPool", column: "roster" },
  { table: "BucksParlayDefinition", column: "subjects" },
  { table: "ChallengeRunRevision", column: "selectedAccountsJson" },
  { table: "ConfirmationIntent", column: "payload" },
  { table: "DuelGame", column: "evidenceJson" },
  { table: "ExploreMessage", column: "preview" },
  { table: "ExploreMessage", column: "trace" },
  { table: "HallRecordBreakOutbox", column: "payloadJson" },
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
  // A captured game's frozen per-target facts, kept for audit — settlement
  // re-reads `leafHits` alone. Its subjects come from the Dare's own target
  // list, which is a tracked source and cascades with it.
  { table: "BucksDareGame", column: "snapshot" },
  // A pending record-break announcement. Its holders are copied from the Hall
  // cells that produced it, and those are tracked sources.
  { table: "HallRecordBreakOutbox", column: "payloadJson" },
  // A duel game's evidence carries the match's whole participant list, so it is
  // the same ten-strangers shape as a match pool roster. The competitors that
  // matter are tracked through DuelCompetitorMember.
  { table: "DuelGame", column: "evidenceJson" },
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
  // Dated by `updatedAt`, not by when the row appeared. These collections gain
  // identities after creation — a player joins a lobby, another tracked player
  // is detected in a game already being watched — and the container's creation
  // time would put a post-cutover arrival before the cutover, reporting a
  // healthy new-domain identity as work this migration skipped.
  //
  // The opposite error, excusing a genuinely skipped identity because the row
  // was touched later, is not reachable: `apply` refuses to run while any
  // tracked identity is unmapped, so nothing unmapped can predate the marker
  // except through `--allow-unresolved`, which records a map row either way.
  bareArrayJson("ActiveGame", "trackedPuuids", "updatedAt"),
  bareArrayJson("TournamentLobby", "bluePuuids", "updatedAt"),
  bareArrayJson("TournamentLobby", "redPuuids", "updatedAt"),
  bareArrayJson("TournamentLobby", "joinedPuuids", "updatedAt"),
  objectJson("BucksDareTarget", "accounts", "createdAt"),
  objectJson("BucksDareV2Target", "accounts", "createdAt"),
  objectJson("BucksDareV2Revision", "targetsJson", "createdAt"),
  // A rank Dare's activation snapshot freezes the account whose rank is the
  // baseline, under `sourcePuuid`. Settlement compares live results against it
  // for the life of the contract, so it stays load-bearing long after the
  // snapshot was taken.
  // `updatedAt` because the row is created when activation is requested and the
  // snapshot is written only once activation succeeds, which can be much later.
  objectJson("BucksDareV2Activation", "snapshotJson", "updatedAt"),
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
  // Also mutable: a cell's holders change whenever the record is broken.
  objectJson("HallRecordCell", "holdersJson", "updatedAt"),
  objectJson("HallRecordCell", "evidenceJson", "updatedAt"),
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
