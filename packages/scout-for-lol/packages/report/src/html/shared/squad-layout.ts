const MAX_PLAYERS_PER_ROW = 5;

/**
 * Split tracked players into balanced rows, guaranteeing no row ever exceeds
 * MAX_PLAYERS_PER_ROW. A single match has at most ten distinct participants, so
 * the common case is one or two rows — but the same puuid can be tracked in
 * multiple guilds, and polling passes each config through without deduping, so
 * `players` can exceed ten. Deriving the row count from the cap (rather than
 * hardcoding two rows) keeps every row within the limit instead of overflowing
 * the banner columns. For one to ten players this yields the exact same split
 * as before (one row up to five; two balanced rows for six to ten).
 */
export function splitSquad<T>(players: readonly T[]): T[][] {
  if (players.length <= MAX_PLAYERS_PER_ROW) {
    return [[...players]];
  }

  const rowCount = Math.ceil(players.length / MAX_PLAYERS_PER_ROW);
  const perRow = Math.ceil(players.length / rowCount);
  const rows: T[][] = [];
  for (let start = 0; start < players.length; start += perRow) {
    rows.push(players.slice(start, start + perRow));
  }
  return rows;
}
