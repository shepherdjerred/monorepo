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
