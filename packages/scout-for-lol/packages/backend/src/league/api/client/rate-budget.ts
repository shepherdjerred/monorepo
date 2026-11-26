/**
 * Pure Riot rate-budget ledger.
 *
 * Riot enforces limits per routing host, and `X-App-Rate-Limit-Count` reports
 * the whole key's usage on that host, so every response teaches a pod what all
 * pods have spent. The ledger admits a request only while that observed usage
 * (plus what this pod has sent since and not yet seen reflected) stays under
 * the request's class limits in every learned window.
 *
 * Tracked classes (`realtime`, `interactive`, `backfill`) have two limits: a
 * share ceiling on tracked usage (the window minus the crawl's share) and a
 * total cap on everything. The crawl has one limit, its utilisation target,
 * against the total, so it fills only what tracked traffic leaves of the
 * target. The caps are strictly ordered, crawl maximum < non-realtime total cap
 * < realtime total cap (0.85 < 0.90 < 0.95), so a saturated crawl always leaves
 * interactive and backfill 5% of every window and realtime a further 5%.
 *
 * The crawl's share is exact where the crawl runs in this process (`attributed`)
 * because its responses pass through this ledger. Elsewhere it is bounded by the
 * crawl's target while the crawl is enabled, which can let tracked traffic
 * overshoot its share ceiling while the crawl idles; the total cap still holds.
 *
 * No I/O and no ambient clock: callers inject `clock` (or pass `now` to `admit`).
 */

import {
  parseAppRateLimitWindows,
  parseMethodRateLimitWindows,
  parseRateLimitType,
} from "./rate-limit-headers.ts";

export type RiotPriority = "realtime" | "interactive" | "backfill" | "crawl";

export type TrackedRiotPriority = Exclude<RiotPriority, "crawl">;

/** Highest first: the order the limiter serves its per-class queues in. */
export const RIOT_PRIORITIES: readonly RiotPriority[] = [
  "realtime",
  "interactive",
  "backfill",
  "crawl",
];

/**
 * `observe` consults the ledger and records its decision but always admits;
 * `enforce` holds a refused request until the ledger admits it. The crawl's
 * own requests are always enforced (see `RateLimitedRequestOptions`).
 */
export type RiotBudgetMode = "observe" | "enforce";

export type RiotBudgetConfig = {
  /**
   * Fraction of each window's limit a tracked class's tracked usage may fill.
   * `crawl` is the crawl target used when no `crawl.target` reader is given.
   */
  ceilings: Record<RiotPriority, number>;
  /** Fraction of each window's whole usage, crawl included, a tracked class may reach. */
  totalCaps: Record<TrackedRiotPriority, number>;
  /** The highest crawl target honoured; a higher flag value is clamped to it. */
  maxCrawlTarget: number;
  /** Retry hint when a single probe request is already in flight. */
  probeWaitMs: number;
  /** Cooldown for a 429 that carries no `Retry-After`. */
  defaultRetryAfterMs: number;
};

export const DEFAULT_RIOT_BUDGET_CONFIG: RiotBudgetConfig = {
  ceilings: { realtime: 0.95, interactive: 0.85, backfill: 0.6, crawl: 0.25 },
  totalCaps: { realtime: 0.95, interactive: 0.9, backfill: 0.9 },
  maxCrawlTarget: 0.85,
  probeWaitMs: 100,
  defaultRetryAfterMs: 1000,
};

export type AdmitReason =
  "retry-after" | "probe-in-flight" | "app-window" | "method-window";

export type AdmitResult =
  { ok: true } | { ok: false; waitMs: number; reason: AdmitReason };

type WindowState = {
  limit: number;
  count: number;
  /** Responses to this ledger's crawl requests counted in this window. */
  crawlCount: number;
  /**
   * Latest instant the window can still be running. Riot windows start at an
   * unseen first request, so this is estimated from the first observation of
   * the window and is never earlier than the true reset.
   */
  resetAt: number;
};

type Scope = {
  windows: Map<number, WindowState>;
  /** Requests admitted whose responses have not been observed yet. */
  unconfirmed: number;
  /** The crawl's part of `unconfirmed`. */
  crawlUnconfirmed: number;
  observedAt: number | undefined;
  blockedUntil: number;
  /** A cooldown from a 429 on crawl traffic: it holds the crawl alone. */
  crawlBlockedUntil: number;
  /** Set by a 429 cooldown; cleared by the next observation. */
  needsProbe: boolean;
  /** Set by a crawl 429; only the crawl probes, so tracked traffic never waits on it. */
  crawlNeedsProbe: boolean;
};

function newScope(): Scope {
  return {
    windows: new Map(),
    unconfirmed: 0,
    crawlUnconfirmed: 0,
    observedAt: undefined,
    blockedUntil: 0,
    crawlBlockedUntil: 0,
    needsProbe: false,
    crawlNeedsProbe: false,
  };
}

export type RiotCrawlBudget = {
  /** The crawl's utilisation target in [0, 1]; read on every admission. */
  target: () => number;
  /** Whether the crawl is switched on; read on every tracked admission. */
  enabled: () => boolean;
  /**
   * Whether every crawl request the key makes passes through this ledger (the
   * crawl runs in this process), making its observed share exact.
   */
  attributed: boolean;
};

export type RiotBudgetLedgerOptions = {
  clock: () => number;
  config?: RiotBudgetConfig;
  /**
   * The crawl's target and where it runs. Default: the config's crawl ceiling,
   * crawl off, attributed (a ledger that sees all of its own crawl traffic).
   */
  crawl?: RiotCrawlBudget;
};

/** One app-scope window as the ledger last saw it. */
export type RiotWindowUsage = {
  windowSeconds: number;
  limit: number;
  count: number;
  crawlCount: number;
};

export class RiotBudgetLedger {
  private readonly clock: () => number;
  private readonly config: RiotBudgetConfig;
  private readonly crawl: RiotCrawlBudget;
  private readonly scopes = new Map<string, Scope>();

  constructor(options: RiotBudgetLedgerOptions) {
    this.clock = options.clock;
    this.config = options.config ?? DEFAULT_RIOT_BUDGET_CONFIG;
    assertCapOrdering(this.config);
    const ceilings = this.config.ceilings;
    this.crawl = options.crawl ?? {
      target: () => ceilings.crawl,
      enabled: () => false,
      attributed: true,
    };
  }

  /** Whether this ledger's crawl share is exact (the crawl runs through it). */
  get crawlAttributed(): boolean {
    return this.crawl.attributed;
  }

  /** The crawl target in force: the configured target clamped to the maximum. */
  crawlTarget(): number {
    const target = this.crawl.target();
    if (!Number.isFinite(target) || target < 0 || target > 1) {
      throw new Error(
        `Crawl utilisation target must be in [0, 1], got ${String(target)}`,
      );
    }
    return Math.min(target, this.config.maxCrawlTarget);
  }

  /**
   * Decides whether one request may be sent now. An `ok` result reserves the
   * request: it counts against the budget until `observe` or `abandon`.
   */
  admit(input: {
    route: string;
    method: string;
    priority: RiotPriority;
    now?: number;
  }): AdmitResult {
    const now = input.now ?? this.clock();
    const routeScope = this.scope(routeKey(input.route));
    const methodScope = this.scope(methodKey(input.route, input.method));
    const isCrawl = input.priority === "crawl";

    const checks: [Scope, "app-window" | "method-window"][] = [
      [routeScope, "app-window"],
      [methodScope, "method-window"],
    ];

    // Tracked cooldowns apply to every priority, realtime included; a crawl
    // cooldown holds only the crawl.
    for (const [scope] of checks) {
      const until = isCrawl
        ? Math.max(scope.blockedUntil, scope.crawlBlockedUntil)
        : scope.blockedUntil;
      if (until > now) {
        return { ok: false, waitMs: until - now, reason: "retry-after" };
      }
    }

    for (const [scope, reason] of checks) {
      const result = this.checkScope(scope, reason, input.priority, now);
      if (!result.ok) {
        return result;
      }
    }

    this.reserve(input.route, input.method, input.priority);
    return { ok: true };
  }

  /**
   * Records a response's usage headers (success or 429) and releases the
   * request's reservation. Counts are key-wide, so they include other pods.
   */
  observe(
    route: string,
    method: string,
    headers: Headers,
    priority: RiotPriority,
  ): void {
    const now = this.clock();
    const routeScope = this.scope(routeKey(route));
    const methodScope = this.scope(methodKey(route, method));
    const windows = {
      app: parseAppRateLimitWindows(headers),
      method: parseMethodRateLimitWindows(headers),
    };
    this.learn(routeScope, windows.app, { now, priority, required: true });
    this.learn(methodScope, windows.method, { now, priority, required: false });
  }

  /**
   * Counts a request as in flight. `admit` calls it on success; the limiter
   * calls it for a request sent although `admit` refused it (`observe` mode),
   * so its later `observe` or `abandon` releases its own reservation.
   */
  reserve(route: string, method: string, priority: RiotPriority): void {
    for (const scope of this.scopesOf(route, method)) {
      scope.unconfirmed += 1;
      if (priority === "crawl") scope.crawlUnconfirmed += 1;
    }
  }

  /** Releases a reservation whose request produced no response. */
  abandon(route: string, method: string, priority: RiotPriority): void {
    for (const scope of this.scopesOf(route, method)) {
      release(scope, priority);
    }
  }

  /**
   * Records a 429. `application` (and unclassified) limits cool down the
   * route, `method` limits the route+method, and `service` limits are
   * Riot-side load shedding rather than a budget signal, so they are ignored.
   * A 429 on crawl traffic cools down and re-probes the crawl alone: the crawl
   * caused it, and tracked traffic must never be deferred for it. Call
   * `observe` first for the same response to take its counts and release the
   * reservation.
   */
  recordRateLimited(
    route: string,
    method: string,
    headers: Headers,
    priority: RiotPriority,
  ): void {
    const now = this.clock();
    const type = parseRateLimitType(headers);
    if (type === "service") {
      return;
    }
    const scope =
      type === "method"
        ? this.scope(methodKey(route, method))
        : this.scope(routeKey(route));
    const retryAfter = headers.get("retry-after");
    const retryAfterSeconds = Number(retryAfter);
    const cooldownMs =
      retryAfter !== null &&
      Number.isFinite(retryAfterSeconds) &&
      retryAfterSeconds >= 0
        ? retryAfterSeconds * 1000
        : this.config.defaultRetryAfterMs;
    if (priority === "crawl") {
      scope.crawlBlockedUntil = Math.max(
        scope.crawlBlockedUntil,
        now + cooldownMs,
      );
      scope.crawlNeedsProbe = true;
      return;
    }
    scope.blockedUntil = Math.max(scope.blockedUntil, now + cooldownMs);
    scope.needsProbe = true;
  }

  /** The app-scope windows last learned for a route, for metrics. */
  windowUsage(route: string): RiotWindowUsage[] {
    const scope = this.scopes.get(routeKey(route));
    if (scope === undefined) return [];
    return [...scope.windows.entries()].map(([windowSeconds, state]) => ({
      windowSeconds,
      limit: state.limit,
      count: state.count,
      crawlCount: Math.min(state.crawlCount, state.count),
    }));
  }

  private scope(key: string): Scope {
    let scope = this.scopes.get(key);
    if (scope === undefined) {
      scope = newScope();
      this.scopes.set(key, scope);
    }
    return scope;
  }

  private scopesOf(route: string, method: string): Scope[] {
    return [this.scope(routeKey(route)), this.scope(methodKey(route, method))];
  }

  private learn(
    scope: Scope,
    windows: { windowSeconds: number; count: number; limit: number }[],
    context: { now: number; priority: RiotPriority; required: boolean },
  ): void {
    release(scope, context.priority);
    // An app-scope response without usage headers (an upstream error, say)
    // teaches nothing: keep the scope unlearned so the single-probe rule still
    // holds. A method scope without windows simply has no method limit.
    if (context.required && windows.length === 0) {
      return;
    }
    const { now } = context;
    scope.observedAt = now;
    scope.needsProbe = false;
    scope.crawlNeedsProbe = false;
    const crawlResponse = context.priority === "crawl" ? 1 : 0;
    for (const window of windows) {
      const previous = scope.windows.get(window.windowSeconds);
      const sameWindow =
        previous !== undefined &&
        now < previous.resetAt &&
        window.count >= previous.count;
      scope.windows.set(window.windowSeconds, {
        limit: window.limit,
        count: window.count,
        crawlCount: (sameWindow ? previous.crawlCount : 0) + crawlResponse,
        resetAt: sameWindow
          ? previous.resetAt
          : now + window.windowSeconds * 1000,
      });
    }
  }

  private checkScope(
    scope: Scope,
    reason: "app-window" | "method-window",
    priority: RiotPriority,
    now: number,
  ): AdmitResult {
    const windows = [...scope.windows.entries()];
    const shortestMs = Math.min(...windows.map(([seconds]) => seconds * 1000));
    const expired = windows.some(([, state]) => now >= state.resetAt);
    const unknown =
      scope.observedAt === undefined ||
      scope.needsProbe ||
      (priority === "crawl" && scope.crawlNeedsProbe) ||
      expired ||
      now - scope.observedAt >= shortestMs;

    // Slow start: with no fresh response the counts mean nothing, so one probe
    // may be outstanding until its response arrives. Tracked traffic never
    // waits on a crawl probe (it probes alongside it), and the crawl probes
    // only while nothing else is in flight, so after a restart the first
    // response is a tracked probe or a single crawl probe, never a burst.
    const inFlight =
      priority === "crawl"
        ? scope.unconfirmed
        : scope.unconfirmed - scope.crawlUnconfirmed;
    if (unknown && inFlight > 0) {
      return {
        ok: false,
        waitMs: this.config.probeWaitMs,
        reason: "probe-in-flight",
      };
    }

    for (const [seconds, state] of windows) {
      if (unknown && now >= state.resetAt) {
        continue;
      }
      const untilReset = Math.max(1, state.resetAt - now);
      if (priority === "crawl") {
        const waitMs = this.crawlWait(scope, state, seconds * 1000, now);
        if (waitMs !== undefined) {
          return { ok: false, waitMs: Math.min(waitMs, untilReset), reason };
        }
      } else if (!this.trackedFits(scope, state, priority)) {
        return { ok: false, waitMs: untilReset, reason };
      }
    }
    return { ok: true };
  }

  /**
   * How long one more crawl request must wait in this window, or `undefined`
   * when it may go now. The crawl is paced through the window: by elapsed
   * fraction f it may have brought the total to f of its target, so tracked
   * traffic arriving later in the window still finds its room rather than a
   * window the crawl filled at its start. The window's start is estimated
   * from its first observation, so f is never overstated.
   */
  private crawlWait(
    scope: Scope,
    state: WindowState,
    windowMs: number,
    now: number,
  ): number | undefined {
    const total = state.count + scope.unconfirmed + 1;
    const budget = this.crawlTarget() * state.limit;
    if (total > Math.floor(budget)) {
      return state.resetAt - now;
    }
    const elapsed = Math.min(
      windowMs,
      Math.max(0, windowMs - (state.resetAt - now)),
    );
    return total <= Math.ceil((budget * elapsed) / windowMs)
      ? undefined
      : Math.max(1, Math.ceil((total * windowMs) / budget) - elapsed);
  }

  /** Whether one more tracked request stays inside its share ceiling and total cap. */
  private trackedFits(
    scope: Scope,
    state: WindowState,
    priority: TrackedRiotPriority,
  ): boolean {
    const total = state.count + scope.unconfirmed + 1;
    const tracked =
      state.count -
      this.crawlShare(state) +
      (scope.unconfirmed - scope.crawlUnconfirmed) +
      1;
    return (
      tracked <= Math.floor(this.config.ceilings[priority] * state.limit) &&
      total <= Math.floor(this.config.totalCaps[priority] * state.limit)
    );
  }

  /** How much of a window's observed count is the crawl's. */
  private crawlShare(state: WindowState): number {
    if (this.crawl.attributed) {
      return Math.min(state.crawlCount, state.count);
    }
    return this.crawl.enabled()
      ? Math.min(state.count, Math.floor(this.crawlTarget() * state.limit))
      : 0;
  }
}

/**
 * The invariant that keeps tracked traffic unstarved by a saturated crawl:
 * crawl maximum < every non-realtime total cap < realtime's total cap, and no
 * share ceiling above its class's total cap.
 */
export function assertCapOrdering(config: RiotBudgetConfig): void {
  const { totalCaps, ceilings, maxCrawlTarget } = config;
  const ordered =
    maxCrawlTarget < totalCaps.interactive &&
    maxCrawlTarget < totalCaps.backfill &&
    totalCaps.interactive < totalCaps.realtime &&
    totalCaps.backfill < totalCaps.realtime &&
    totalCaps.realtime <= 1 &&
    ceilings.realtime <= totalCaps.realtime &&
    ceilings.interactive <= totalCaps.interactive &&
    ceilings.backfill <= totalCaps.backfill;
  if (!ordered) {
    throw new Error(
      `Riot budget caps must satisfy crawl max < non-realtime total caps < realtime total cap: ${JSON.stringify({ maxCrawlTarget, totalCaps, ceilings })}`,
    );
  }
}

function release(scope: Scope, priority: RiotPriority): void {
  scope.unconfirmed = Math.max(0, scope.unconfirmed - 1);
  if (priority === "crawl") {
    scope.crawlUnconfirmed = Math.max(0, scope.crawlUnconfirmed - 1);
  }
}

function routeKey(route: string): string {
  return `app|${route}`;
}

function methodKey(route: string, method: string): string {
  return `method|${route}|${method}`;
}
