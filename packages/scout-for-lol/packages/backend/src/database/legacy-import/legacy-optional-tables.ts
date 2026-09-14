/**
 * Tables the promoted SQLite image may not contain.
 *
 * Every other missing table is a hard compatibility error: a silently absent
 * table would import as zero rows and look like a clean cutover while losing
 * data. These are the audited exceptions, each with a reason it can legitimately
 * be absent from an older snapshot.
 */
export const LEGACY_OPTIONAL_TABLES = new Set([
  // Only present once the Riot PUUID key migration has run. An environment that
  // never crossed key domains has no mapping to carry.
  "PuuidKeyMap",
  "PuuidKeyMigration",
  // The promoted image predates the parlay migration. An absent
  // BucksOpenPosition is reconstructed from pending bets in open pools; the
  // attribution and parlay tables are empty historical models.
  "InstallAttributionToken",
  "BucksOpenPosition",
  "BucksParlayDefinition",
  "BucksParlayMarket",
  "BucksParlayBet",
  // The promoted image predates the tournament-lobby migration. Newer snapshots
  // carry these tables and import them; older ones treat them as empty so the
  // cutover can still complete.
  "TournamentRegistration",
  "TournamentLobby",
]);

/**
 * Bryan Bucks was introduced after the oldest retained production SQLite
 * snapshot. That snapshot has no Bucks schema at all, so importing it with
 * empty Bucks models is sound. A partly missing Bucks schema is not an older
 * version we understand: it could discard real ledger data, and must fail.
 */
export const LEGACY_PRE_BUCKS_TABLES = new Set([
  "BucksAccount",
  "BucksMatchPool",
  "BucksMatchEarning",
  "BucksBet",
  "BucksLedgerEntry",
]);

/** Return the audited missing-table allowances for one SQLite snapshot. */
export function optionalTablesForLegacySnapshot(
  missingTables: ReadonlySet<string>,
): ReadonlySet<string> {
  const missingBucksTables = [...LEGACY_PRE_BUCKS_TABLES].filter((table) =>
    missingTables.has(table),
  );
  if (
    missingBucksTables.length > 0 &&
    missingBucksTables.length !== LEGACY_PRE_BUCKS_TABLES.size
  ) {
    throw new Error(
      "Legacy SQLite source has a partial Bryan Bucks schema; refusing to " +
        "treat possibly missing ledger data as an older snapshot.",
    );
  }
  return missingBucksTables.length === 0
    ? LEGACY_OPTIONAL_TABLES
    : new Set([...LEGACY_OPTIONAL_TABLES, ...LEGACY_PRE_BUCKS_TABLES]);
}

/**
 * A completed cutover without its map is not a legitimately older snapshot.
 *
 * The two tables are independently optional because an environment that never
 * crossed key domains has neither. They are not independently optional once one
 * of them says the rewrite HAPPENED. Importing the marker alone would leave the
 * lake believing the database is new-domain while holding nothing to translate
 * the raw S3 payloads with — so every later rebuild would quietly restore
 * old-domain identifiers, and only the retired key could ever have rebuilt the
 * mapping that would fix it.
 *
 * The reverse pairing is fine: a map with no marker is an interrupted migration,
 * which the phases are built to resume.
 */
export function assertPuuidRemapIsIntact(options: {
  mapMissing: boolean;
  appliedCutovers: number;
}): void {
  if (!options.mapMissing || options.appliedCutovers === 0) {
    return;
  }
  throw new Error(
    "Legacy SQLite source records an applied PUUID key cutover but has no " +
      '"PuuidKeyMap" table. Importing it would strand every raw S3 payload in ' +
      "the old identity domain with nothing left able to translate it.",
  );
}
