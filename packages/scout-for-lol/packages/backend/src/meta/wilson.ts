/**
 * Wilson score interval for a binomial rate.
 *
 * Win, pick and ban rates are shares of a finite sample, so the serving JSON
 * states each as a point value with its 95% Wilson interval rather than a bare
 * percentage: the interval stays inside [0, 1], is honest at small n, and is
 * what tier placement is decided on (a champion earns a tier on the lower
 * bound, never on a lucky point estimate).
 */

/** The two-sided 95% normal quantile. */
export const WILSON_Z_95 = 1.96;

export type RateInterval = {
  /** Observed share, `successes / total`; 0 when there is no sample. */
  value: number;
  lower: number;
  upper: number;
};

export function wilsonInterval(
  successes: number,
  total: number,
  z: number = WILSON_Z_95,
): RateInterval {
  if (!Number.isInteger(successes) || !Number.isInteger(total)) {
    throw new TypeError(
      `Wilson interval needs integer counts, got ${successes.toString()}/${total.toString()}`,
    );
  }
  if (total < 0 || successes < 0 || successes > total) {
    throw new Error(
      `Wilson interval needs 0 <= successes <= total, got ${successes.toString()}/${total.toString()}`,
    );
  }
  if (total === 0) return { value: 0, lower: 0, upper: 1 };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) /
    denominator;
  return {
    value: p,
    lower: Math.max(0, centre - margin),
    upper: Math.min(1, centre + margin),
  };
}
