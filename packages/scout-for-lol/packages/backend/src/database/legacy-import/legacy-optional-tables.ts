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
