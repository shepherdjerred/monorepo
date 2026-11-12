/**
 * Pure Riot rate-budget ledger.
 *
 * Riot enforces limits per routing host, and `X-App-Rate-Limit-Count` reports
 * the whole key's usage on that host, so every response teaches a pod what all
 * pods have spent. The ledger admits a request only while that observed usage
 * (plus what this pod has sent since and not yet seen reflected) stays under a
 * per-priority share of every learned window. Realtime may use nearly all of a
 * window; crawl traffic stops at a quarter of it, so the crawl can never push
 * the key into a 429 that a realtime request would then suffer.
 *
 * No I/O and no ambient clock: callers inject `clock` (or pass `now`).
 */

import {
  parseAppRateLimitWindows,
  parseMethodRateLimitWindows,
  parseRateLimitType,
} from "./rate-limit-headers.ts";

export type RiotPriority = "realtime" | "interactive" | "backfill" | "crawl";

export type RiotBudgetConfig = {
  /** Fraction of each window's limit a priority class may fill. */
  ceilings: Record<RiotPriority, number>;
  /** Retry hint when a single probe request is already in flight. */
  probeWaitMs: number;
  /** Cooldown for a 429 that carries no `Retry-After`. */
  defaultRetryAfterMs: number;
};

export const DEFAULT_RIOT_BUDGET_CONFIG: RiotBudgetConfig = {
  ceilings: { realtime: 0.95, interactive: 0.85, backfill: 0.6, crawl: 0.25 },
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
  observedAt: number | undefined;
  blockedUntil: number;
  /** Set by a 429 cooldown; cleared by the next observation. */
  needsProbe: boolean;
};

function newScope(): Scope {
  return {
    windows: new Map(),
    unconfirmed: 0,
    observedAt: undefined,
    blockedUntil: 0,
    needsProbe: false,
  };
}

export type RiotBudgetLedgerOptions = {
  clock: () => number;
  config?: RiotBudgetConfig;
};

export class RiotBudgetLedger {
  private readonly clock: () => number;
  private readonly config: RiotBudgetConfig;
  private readonly scopes = new Map<string, Scope>();

  constructor(options: RiotBudgetLedgerOptions) {
    this.clock = options.clock;
    this.config = options.config ?? DEFAULT_RIOT_BUDGET_CONFIG;
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
    const ceiling = this.config.ceilings[input.priority];
    const routeScope = this.scope(routeKey(input.route));
    const methodScope = this.scope(methodKey(input.route, input.method));

    const checks: [Scope, "app-window" | "method-window"][] = [
      [routeScope, "app-window"],
      [methodScope, "method-window"],
    ];

    // Cooldowns apply to every priority, realtime included.
    for (const [scope] of checks) {
      if (scope.blockedUntil > now) {
        return {
          ok: false,
          waitMs: scope.blockedUntil - now,
          reason: "retry-after",
        };
      }
    }

    for (const [scope, reason] of checks) {
      const result = this.checkScope(scope, reason, ceiling, now);
      if (!result.ok) {
        return result;
      }
    }

    routeScope.unconfirmed += 1;
    methodScope.unconfirmed += 1;
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
    now: number = this.clock(),
  ): void {
    const routeScope = this.scope(routeKey(route));
    const methodScope = this.scope(methodKey(route, method));
    this.learn(routeScope, parseAppRateLimitWindows(headers), now);
    this.learn(methodScope, parseMethodRateLimitWindows(headers), now);
  }

  /** Releases a reservation whose request produced no response. */
  abandon(route: string, method: string): void {
    for (const scope of [
      this.scope(routeKey(route)),
      this.scope(methodKey(route, method)),
    ]) {
      scope.unconfirmed = Math.max(0, scope.unconfirmed - 1);
    }
  }

  /**
   * Records a 429. `application` (and unclassified) limits cool down the
   * route, `method` limits the route+method, and `service` limits are
   * Riot-side load shedding rather than a budget signal, so they are ignored.
   * Call `observe` first for the same response to take its counts and
   * release the reservation.
   */
  recordRateLimited(
    route: string,
    method: string,
    headers: Headers,
    now: number = this.clock(),
  ): void {
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
    scope.blockedUntil = Math.max(scope.blockedUntil, now + cooldownMs);
    scope.needsProbe = true;
  }

  private scope(key: string): Scope {
    let scope = this.scopes.get(key);
    if (scope === undefined) {
      scope = newScope();
      this.scopes.set(key, scope);
    }
    return scope;
  }

  private learn(
    scope: Scope,
    windows: { windowSeconds: number; count: number; limit: number }[],
    now: number,
  ): void {
    scope.unconfirmed = Math.max(0, scope.unconfirmed - 1);
    scope.observedAt = now;
    scope.needsProbe = false;
    for (const window of windows) {
      const previous = scope.windows.get(window.windowSeconds);
      const resetAt =
        previous !== undefined &&
        now < previous.resetAt &&
        window.count >= previous.count
          ? previous.resetAt
          : now + window.windowSeconds * 1000;
      scope.windows.set(window.windowSeconds, {
        limit: window.limit,
        count: window.count,
        resetAt,
      });
    }
  }

  private checkScope(
    scope: Scope,
    reason: "app-window" | "method-window",
    ceiling: number,
    now: number,
  ): AdmitResult {
    const windows = [...scope.windows.entries()];
    const shortestMs = Math.min(...windows.map(([seconds]) => seconds * 1000));
    const expired = windows.some(([, state]) => now >= state.resetAt);
    const unknown =
      scope.observedAt === undefined ||
      scope.needsProbe ||
      expired ||
      now - scope.observedAt >= shortestMs;

    // Slow start: with no fresh response the counts mean nothing, so exactly
    // one probe request may be outstanding until its response arrives.
    if (unknown && scope.unconfirmed > 0) {
      return {
        ok: false,
        waitMs: this.config.probeWaitMs,
        reason: "probe-in-flight",
      };
    }

    for (const [, state] of windows) {
      if (unknown && now >= state.resetAt) {
        continue;
      }
      const cap = Math.floor(ceiling * state.limit);
      if (state.count + scope.unconfirmed + 1 > cap) {
        return { ok: false, waitMs: Math.max(1, state.resetAt - now), reason };
      }
    }
    return { ok: true };
  }
}

function routeKey(route: string): string {
  return `app|${route}`;
}

function methodKey(route: string, method: string): string {
  return `method|${route}|${method}`;
}
