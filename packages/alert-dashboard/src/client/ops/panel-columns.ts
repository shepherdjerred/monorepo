/**
 * Where to cut an ordered run of panels into two columns of near-equal
 * height: the first column takes that many panels and the second the rest.
 * The order is kept, so reading down the first column and then the second is
 * the order the panels were given, which is also their order once the columns
 * stack. `weights` are relative heights, such as rows.
 */
export function columnSplit(weights: readonly number[]): number {
  if (weights.length < 2) return weights.length;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let best = 1;
  let bestGap = Number.POSITIVE_INFINITY;
  let first = 0;
  for (const [index, weight] of weights.slice(0, -1).entries()) {
    first += weight;
    const gap = Math.abs(total - 2 * first);
    if (gap < bestGap) {
      best = index + 1;
      bestGap = gap;
    }
  }
  return best;
}
