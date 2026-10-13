/** Scheduled countdown arrivals already reserve a place in the requested load. */
export function botsToAdd(
  current: { bots: number; arriving: number },
  target: number,
): number {
  return Math.max(0, target - current.bots - current.arriving);
}
