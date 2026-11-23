/**
 * Query the last admitted component mask at or before a replay clock, including
 * all packets at that clock in their original order. A missing track or a time
 * before its initial mask carries no visibility observation.
 * @param {readonly (readonly [number, number])[] | undefined} changes
 * @param {number} timeSeconds
 * @returns {number | null}
 */
export function sampleExactTeamMask(changes, timeSeconds) {
  if (!Number.isFinite(timeSeconds))
    throw Error("Expected a finite team visibility clock");
  if (!changes?.length) return null;
  let start = 0;
  let end = changes.length;
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    if (changes[middle][0] <= timeSeconds) start = middle + 1;
    else end = middle;
  }
  return start === 0 ? null : changes[start - 1][1];
}

/**
 * @param {readonly (readonly [number, number])[] | undefined} changes
 * @param {number} timeSeconds
 * @param {100 | 200} team
 * @returns {boolean | null}
 */
export function sampleExactTeamVisibility(changes, timeSeconds, team) {
  if (team !== 100 && team !== 200)
    throw Error("Expected an exact team visibility side");
  const mask = sampleExactTeamMask(changes, timeSeconds);
  return mask === null ? null : Boolean(mask & (team === 100 ? 2 : 4));
}
