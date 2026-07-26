const MAX_PLAYERS_PER_ROW = 5;

export function splitSquad<T>(players: readonly T[]): T[][] {
  if (players.length <= MAX_PLAYERS_PER_ROW) {
    return [[...players]];
  }

  const firstRowCount = Math.ceil(players.length / 2);
  return [players.slice(0, firstRowCount), players.slice(firstRowCount)];
}
