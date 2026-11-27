/** A rate in percent as a whole number: 59.3 reads "59%". */
export function wholePercent(percent: number): string {
  return `${Math.round(percent).toString()}%`;
}
