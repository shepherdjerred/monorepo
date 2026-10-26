/** Retained scheduled Activity commands complete without economic effects. */
export function temporalWorkRetired(kind: string): boolean {
  return kind === "bucks-reconciliation" || kind === "weekly-bucks-leaderboard";
}
