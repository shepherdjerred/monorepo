/** The games behind a win rate, with thousands separators: "7,840 games". */
export function gamesLabel(games: number): string {
  return `${games.toLocaleString("en-US")} ${games === 1 ? "game" : "games"}`;
}
