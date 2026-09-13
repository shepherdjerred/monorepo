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
  readonly #label: string;

  constructor(label: string, windows: readonly RateWindow[]) {
    this.#label = label;
    this.#windows = [...windows];
  }

  get windows(): readonly RateWindow[] {
    return this.#windows;
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
      if (inWindow.length < window.limit) {
        continue;
      }
      // The oldest request holding this window open frees a slot when it ages
      // out, so sleep exactly that long rather than polling.
      const oldest = inWindow[inWindow.length - window.limit] ?? now;
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
