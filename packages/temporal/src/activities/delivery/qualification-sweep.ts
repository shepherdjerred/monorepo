/** Builds qualified concurrently; each holds a per-service qualification lock. */
export const QUALIFICATION_CONCURRENCY = 3;

/**
 * Wall time after which a tick starts no further wave. A wave's requests are
 * bounded by the 30 second Delivery request timeout, so the last wave still
 * settles inside the two minute qualification Activity timeout.
 */
export const QUALIFICATION_BUDGET_MS = 30_000;

/**
 * Qualify the pending page in waves until it is drained or the tick's budget
 * is spent. One main pipeline registers a build for every catalog service, so
 * a fixed handful per one-minute tick falls behind main and delays every
 * version set, including changed charts, by hours. A rejected request fails
 * the tick after its wave settles, as before.
 */
export async function qualifyPendingBuilds(
  builds: readonly { readonly id: string }[],
  qualify: (buildId: string) => Promise<unknown>,
  options: {
    readonly now?: () => number;
    readonly budgetMs?: number;
    readonly concurrency?: number;
  } = {},
): Promise<number> {
  const now = options.now ?? Date.now;
  const concurrency = options.concurrency ?? QUALIFICATION_CONCURRENCY;
  const deadline = now() + (options.budgetMs ?? QUALIFICATION_BUDGET_MS);
  let attempted = 0;
  while (attempted < builds.length && now() < deadline) {
    const wave = builds.slice(attempted, attempted + concurrency);
    const outcomes = await Promise.allSettled(
      wave.map(async (build) => await qualify(build.id)),
    );
    for (const outcome of outcomes)
      if (outcome.status === "rejected") throw outcome.reason;
    attempted += wave.length;
  }
  return attempted;
}
