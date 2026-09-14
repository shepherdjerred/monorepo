/**
 * Rate budgeting for both Riot keys, from what each key actually reports.
 *
 * Riot publishes its ceilings in every response. `X-App-Rate-Limit` carries the
 * key's own windows and `X-Method-Rate-Limit` the per-endpoint ones, both as
 * `count:seconds` pairs. A request consumes a slot in EVERY window of BOTH
 * headers, so the effective rate is the tightest of them — which is not always
 * the app limit. Measured on 2026-09-13, `account-v1` reports `1000:60`, and
 * for the production key that 16.7/s method ceiling binds well before its
 * 50/s app ceiling does.
 *
 * Budgets are a fraction of published rather than the whole thing. These runs
 * are long enough that a 429 storm costs more than the headroom saves, and the
 * production key is shared with Scout's live polling — `X-App-Rate-Limit-Count`
 * is app-wide, so staying under a fraction of the limit leaves room for
 * ingestion rather than racing it.
 */

/** Fraction of every published limit this migration is allowed to use. */
export const BUDGET_FRACTION = 0.8;

/** One `count:seconds` pair from a Riot rate-limit header. */
export type RateWindow = { limit: number; seconds: number };

/**
 * Parse `"100:120,20:1"` into windows, already scaled to the budget.
 *
 * A window is never scaled below 1: a ceiling of zero would deadlock rather
 * than throttle, which is a worse failure than running slightly over budget on
 * an implausibly small limit.
 */
export function parseRateLimitHeader(header: string): RateWindow[] {
  const windows: RateWindow[] = [];
  for (const pair of header.split(",")) {
    const trimmed = pair.trim();
    if (trimmed === "") {
      continue;
    }
    const match = /^(\d+):(\d+)$/.exec(trimmed);
    if (match === null) {
      throw new Error(
        `Unparseable Riot rate-limit header segment ${JSON.stringify(trimmed)} in ${JSON.stringify(header)}`,
      );
    }
    const limit = Number(match[1]);
    const seconds = Number(match[2]);
    if (limit <= 0 || seconds <= 0) {
      throw new Error(
        `Riot reported a non-positive rate window ${trimmed} in ${JSON.stringify(header)}`,
      );
    }
    windows.push({
      limit: Math.max(1, Math.floor(limit * BUDGET_FRACTION)),
      seconds,
    });
  }
  if (windows.length === 0) {
    throw new Error(
      `Riot rate-limit header carried no windows: ${JSON.stringify(header)}`,
    );
  }
  return windows;
}

/**
 * A token bucket over several windows at once.
 *
 * Timestamps are wall-clock rather than monotonic, deliberately. The harvest
 * runs for days on a laptop that sleeps, and a suspended process should wake to
 * find its windows long expired — which is what wall-clock arithmetic says and
 * a monotonic clock does not.
 */
export class RateLimiter {
  #windows: RateWindow[];
  #recent: number[] = [];
  #adopted = false;
  #observed: { at: number; counts: Map<number, number> } | undefined;
  readonly #label: string;

  constructor(label: string, windows: readonly RateWindow[]) {
    this.#label = label;
    this.#windows = [...windows];
  }

  get windows(): readonly RateWindow[] {
    return this.#windows;
  }

  /**
   * Note how full the key's windows are ACROSS EVERY CALLER.
   *
   * `X-App-Rate-Limit-Count` is app-wide, not per-process. During a migration
   * the same key is usually still serving live traffic — Scout's own prematch
   * and postmatch polling — and a limiter that counts only its own requests
   * would spend the whole budget and leave the application to collect the 429s.
   *
   * So the budget is a ceiling on TOTAL usage rather than on ours. Whatever
   * other callers have already spent in a window is subtracted from what this
   * process may spend in it, which makes the migration yield to live traffic
   * automatically instead of being told a fixed share to keep out of.
   */
  observeUsage(countHeader: string | null): void {
    if (countHeader === null) {
      return;
    }
    const counts = new Map<number, number>();
    for (const pair of countHeader.split(",")) {
      const match = /^(\d+):(\d+)$/.exec(pair.trim());
      if (match !== null) {
        counts.set(Number(match[2]), Number(match[1]));
      }
    }
    this.#observed = { at: Date.now(), counts };
  }

  /**
   * How many of a window's slots other callers hold right now.
   *
   * Our own recent requests are subtracted, so this is what everyone ELSE is
   * using. A stale observation is discarded rather than trusted: the count
   * decays as the window rolls, and an old one would understate the headroom
   * and stall this process for no reason.
   */
  #externalUsage(window: RateWindow, now: number): number {
    const observed = this.#observed;
    if (observed === undefined || now - observed.at > window.seconds * 1000) {
      return 0;
    }
    const total = observed.counts.get(window.seconds);
    if (total === undefined) {
      return 0;
    }
    const spanMs = window.seconds * 1000;
    const ours = this.#recent.filter(
      (t) => observed.at - t < spanMs && t <= observed.at,
    ).length;
    return Math.max(0, total - ours);
  }

  /**
   * Replace the bootstrap budget with what this key actually reports.
   *
   * Done once, from the first response. A key whose tier changed, or a constant
   * that drifted from reality, then corrects itself instead of running at a
   * silently wrong rate for days.
   */
  adopt(appHeader: string | null, methodHeader: string | null): void {
    if (appHeader === null || this.#adopted) {
      return;
    }
    const windows = parseRateLimitHeader(appHeader);
    if (methodHeader !== null) {
      windows.push(...parseRateLimitHeader(methodHeader));
    }
    this.#windows = windows;
    this.#adopted = true;
    console.log(
      `  ${this.#label}: budgeting ${(BUDGET_FRACTION * 100).toString()}% of ` +
        `app ${appHeader}${methodHeader === null ? "" : ` and method ${methodHeader}`} — ` +
        windows
          .map((w) => `${w.limit.toString()}/${w.seconds.toString()}s`)
          .join(", "),
    );
  }

  /**
   * Wait out the longest window before the first request of a run.
   *
   * A restarted process cannot know how much of a window its predecessor spent,
   * and the supervisor restarts this job on every crash. Without this a crash
   * loop becomes a burst; with it, the cost is one window per restart.
   */
  async waitOutColdStart(): Promise<void> {
    const longest = Math.max(...this.#windows.map((w) => w.seconds));
    console.log(
      `  ${this.#label}: cold start, waiting ${longest.toString()}s so a previous run's window cannot be double-spent`,
    );
    await Bun.sleep(longest * 1000);
  }

  /** Block until every window has room, then claim a slot in all of them. */
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const longestMs = Math.max(...this.#windows.map((w) => w.seconds)) * 1000;
      this.#recent = this.#recent.filter((t) => now - t < longestMs);

      const waitMs = this.#waitFor(now);
      if (waitMs === 0) {
        this.#recent.push(now);
        return;
      }
      await Bun.sleep(waitMs);
    }
  }

  /** Milliseconds until every window has room; 0 when one is free now. */
  #waitFor(now: number): number {
    let wait = 0;
    for (const window of this.#windows) {
      const spanMs = window.seconds * 1000;
      const inWindow = this.#recent.filter((t) => now - t < spanMs);
      // What is left for us once other callers on this key are accounted for.
      const ourLimit = window.limit - this.#externalUsage(window, now);

      if (ourLimit <= 0) {
        // Other traffic alone has reached the ceiling. Wait for the observation
        // to age out rather than trickling requests through: past that point it
        // no longer describes the window, `#externalUsage` returns nothing, and
        // the next attempt measures the key afresh. That is also why this can
        // never deadlock — the only thing refreshing an observation is a request
        // of ours, so the recovery must not depend on making one.
        const observedAt = this.#observed?.at ?? now;
        wait = Math.max(wait, observedAt + spanMs - now + 1);
        continue;
      }
      if (inWindow.length < ourLimit) {
        continue;
      }
      // The oldest request holding this window open frees a slot when it ages
      // out, so sleep exactly that long rather than polling. With no request of
      // our own in the window, the wait is for someone else's to age out, and
      // one window is the longest that can take.
      const oldest = inWindow[inWindow.length - ourLimit] ?? now - spanMs;
      wait = Math.max(wait, oldest + spanMs - now + 1);
    }
    return wait;
  }
}

/**
 * Roughly how many minutes `count` requests take under a set of windows.
 *
 * Derived from the windows the limiter will actually enforce, so a progress
 * estimate cannot disagree with the throttle producing it.
 */
export function minutesFor(
  count: number,
  windows: readonly RateWindow[],
): number {
  const slowest = Math.max(
    ...windows.map((w) => (count / w.limit) * w.seconds),
  );
  return Math.ceil(slowest / 60);
}
