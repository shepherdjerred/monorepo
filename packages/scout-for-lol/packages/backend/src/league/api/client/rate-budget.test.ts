import { describe, expect, test } from "vitest";
import {
  riotApiAppWindowCrawlShareRatio,
  riotApiAppWindowUtilisationRatio,
} from "#src/metrics/riot-rate-limit.ts";
import { RiotBudgetRefusedError, RiotHttpError } from "./errors.ts";
import {
  DEFAULT_RIOT_BUDGET_CONFIG,
  RiotBudgetLedger,
  assertCapOrdering,
  type RiotCrawlBudget,
  type RiotPriority,
} from "./rate-budget.ts";
import { RateLimiter } from "./rate-limiter.ts";

/**
 * The crawl-target rules on one 1000-request window, so a count reads as a
 * per-mille share of it. Each pod is a ledger; a key-wide `Riot` counter plays
 * the count header every response carries.
 */

const ROUTE = "americas";
const METHOD = "match";
const LIMIT = 1000;
const WINDOW_MS = 10_000;
/** The crawl is paced through each window; just before its end it may fill all of it. */
const LATE = WINDOW_MS - 1;

class Riot {
  count = 0;

  headers(extra: Record<string, string> = {}): Headers {
    return new Headers({
      "x-app-rate-limit": `${LIMIT.toString()}:10`,
      "x-app-rate-limit-count": `${this.count.toString()}:10`,
      ...extra,
    });
  }
}

function pod(crawl: Partial<RiotCrawlBudget> = {}) {
  let now = 0;
  const ledger = new RiotBudgetLedger({
    clock: () => now,
    crawl: {
      target: () => 0.85,
      enabled: () => true,
      attributed: true,
      ...crawl,
    },
  });
  return {
    ledger,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

/** Sends one request of `priority` if admitted; returns whether it was. */
function send(
  ledger: RiotBudgetLedger,
  riot: Riot,
  priority: RiotPriority,
): boolean {
  const decision = ledger.admit({ route: ROUTE, method: METHOD, priority });
  if (!decision.ok) return false;
  riot.count += 1;
  ledger.observe(ROUTE, METHOD, riot.headers(), priority);
  return true;
}

/** Sends `priority` requests until the ledger refuses; returns how many went. */
function saturate(
  ledger: RiotBudgetLedger,
  riot: Riot,
  priority: RiotPriority,
): number {
  let sent = 0;
  while (send(ledger, riot, priority)) sent += 1;
  return sent;
}

/** Teaches a ledger the key-wide count without counting a request of its own. */
function learn(ledger: RiotBudgetLedger, riot: Riot): void {
  ledger.reserve(ROUTE, METHOD, "realtime");
  ledger.observe(ROUTE, METHOD, riot.headers(), "realtime");
}

describe("RiotBudgetLedger cap ordering", () => {
  test("crawl maximum < non-realtime total caps < realtime total cap", () => {
    const { maxCrawlTarget, totalCaps, ceilings } = DEFAULT_RIOT_BUDGET_CONFIG;
    expect(maxCrawlTarget).toBe(0.85);
    expect(totalCaps).toEqual({
      realtime: 0.95,
      interactive: 0.9,
      backfill: 0.9,
    });
    for (const higher of ["interactive", "backfill"] as const) {
      expect(maxCrawlTarget).toBeLessThan(totalCaps[higher]);
      expect(totalCaps[higher]).toBeLessThan(totalCaps.realtime);
      expect(ceilings[higher]).toBeLessThanOrEqual(totalCaps[higher]);
    }
    expect(() => {
      assertCapOrdering(DEFAULT_RIOT_BUDGET_CONFIG);
    }).not.toThrow();
  });

  test.each([
    ["crawl maximum at a non-realtime cap", { maxCrawlTarget: 0.9 }],
    [
      "a non-realtime cap at realtime's",
      {
        totalCaps: {
          ...DEFAULT_RIOT_BUDGET_CONFIG.totalCaps,
          interactive: 0.95,
        },
      },
    ],
    [
      "a share ceiling above its total cap",
      {
        ceilings: { ...DEFAULT_RIOT_BUDGET_CONFIG.ceilings, backfill: 0.92 },
      },
    ],
  ])("a ledger refuses to start with %s", (_name, override) => {
    expect(
      () =>
        new RiotBudgetLedger({
          clock: () => 0,
          config: { ...DEFAULT_RIOT_BUDGET_CONFIG, ...override },
        }),
    ).toThrow(/crawl max < non-realtime total caps/u);
  });

  test("a target above the maximum is clamped; an invalid one fails loudly", () => {
    expect(pod({ target: () => 1 }).ledger.crawlTarget()).toBe(0.85);
    expect(pod({ target: () => 0.5 }).ledger.crawlTarget()).toBe(0.5);
    for (const invalid of [Number.NaN, -0.1, 1.2]) {
      expect(() => pod({ target: () => invalid }).ledger.crawlTarget()).toThrow(
        /must be in \[0, 1\]/u,
      );
    }
  });
});

describe("RiotBudgetLedger crawl target", () => {
  test("the crawl is paced through the window, never front-loading it", () => {
    const riot = new Riot();
    const { ledger, advance } = pod();
    send(ledger, riot, "realtime");
    // At the window's first instant the crawl may not run ahead at all.
    expect(saturate(ledger, riot, "crawl")).toBe(0);
    advance(WINDOW_MS / 2);
    // Halfway through, it may have brought the total to half its target...
    expect(saturate(ledger, riot, "crawl")).toBe(424);
    expect(riot.count).toBe(425);
    // ...and is told when the next request fits: 1/850 of the window later.
    expect(
      ledger.admit({ route: ROUTE, method: METHOD, priority: "crawl" }),
    ).toEqual({ ok: false, waitMs: 12, reason: "app-window" });
    // Tracked traffic is not paced: a realtime burst fits at once.
    for (let index = 0; index < 400; index += 1) {
      expect(send(ledger, riot, "realtime")).toBe(true);
    }
  });

  test("the crawl fills only what tracked traffic leaves of the target", () => {
    const riot = new Riot();
    const { ledger, advance } = pod();
    for (let index = 0; index < 100; index += 1) send(ledger, riot, "realtime");

    advance(LATE);
    expect(saturate(ledger, riot, "crawl")).toBe(750);
    expect(riot.count).toBe(850);
    expect(
      ledger.admit({ route: ROUTE, method: METHOD, priority: "crawl" }),
    ).toMatchObject({ ok: false, reason: "app-window" });
  });

  test("a target of zero admits no crawl request at all", () => {
    const riot = new Riot();
    const { ledger, advance } = pod({ target: () => 0 });
    send(ledger, riot, "realtime");
    advance(LATE);
    expect(saturate(ledger, riot, "crawl")).toBe(0);
  });

  test("the crawl is starved while higher classes use the whole target", () => {
    const riot = new Riot();
    const { ledger, advance } = pod();
    expect(saturate(ledger, riot, "backfill")).toBe(600);
    for (let index = 0; index < 250; index += 1) {
      expect(send(ledger, riot, "realtime")).toBe(true);
    }
    expect(riot.count).toBe(850);
    advance(LATE);
    expect(saturate(ledger, riot, "crawl")).toBe(0);
  });

  test("the target is read on every admission, so a ramp step lands at once", () => {
    const riot = new Riot();
    let target = 0.25;
    const { ledger, advance } = pod({ target: () => target });
    send(ledger, riot, "realtime");
    advance(LATE);
    expect(saturate(ledger, riot, "crawl")).toBe(249);
    target = 0.5;
    expect(saturate(ledger, riot, "crawl")).toBe(250);
  });
});

describe("RiotBudgetLedger strict priority under a saturated crawl", () => {
  test("activity worker (crawl attributed): tracked classes keep their bands", () => {
    const riot = new Riot();
    const { ledger, advance } = pod();
    send(ledger, riot, "realtime");
    advance(LATE);
    saturate(ledger, riot, "crawl");
    expect(riot.count).toBe(850);

    // Backfill's 0.6 share counts tracked usage only, so the crawl's 849 does
    // not starve it; the non-realtime total cap (0.90) stops it.
    expect(saturate(ledger, riot, "backfill")).toBe(50);
    expect(saturate(ledger, riot, "interactive")).toBe(0);
    // Realtime keeps the last band, which no other class can take.
    expect(saturate(ledger, riot, "realtime")).toBe(50);
    expect(riot.count).toBe(950);
  });

  test("app or gateway pod (crawl elsewhere): the crawl's bound stands in for its share", () => {
    const riot = new Riot();
    const { ledger } = pod({ attributed: false });
    riot.count = 850; // the crawl, on the activity worker, saturated the target
    learn(ledger, riot);

    expect(saturate(ledger, riot, "interactive")).toBe(50);
    expect(saturate(ledger, riot, "backfill")).toBe(0);
    expect(saturate(ledger, riot, "realtime")).toBe(50);
    expect(riot.count).toBe(950);
  });

  test("app pod with the crawl idle: a backfill burst overshoots its share but stops at 0.90", () => {
    const riot = new Riot();
    const { ledger } = pod({ attributed: false });
    send(ledger, riot, "realtime");

    expect(saturate(ledger, riot, "backfill")).toBe(899);
    expect(riot.count).toBe(900);
    expect(saturate(ledger, riot, "realtime")).toBe(50);
  });

  test("app pod with the crawl off: tracked ceilings are exactly as before", () => {
    const riot = new Riot();
    const { ledger } = pod({ attributed: false, enabled: () => false });
    send(ledger, riot, "realtime");

    expect(saturate(ledger, riot, "backfill")).toBe(599);
    expect(saturate(ledger, riot, "interactive")).toBe(250);
    expect(saturate(ledger, riot, "realtime")).toBe(100);
  });
});

function admit(ledger: RiotBudgetLedger, priority: RiotPriority) {
  return ledger.admit({ route: ROUTE, method: METHOD, priority });
}

/** A 429 response's headers, as Riot sends them for an application limit. */
function limited(riot: Riot, retryAfter?: string): Headers {
  return riot.headers({
    "x-rate-limit-type": "application",
    ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
  });
}

describe("RiotBudgetLedger slow start after a restart", () => {
  test("tracked traffic never waits on a crawl probe", () => {
    const { ledger } = pod();
    expect(admit(ledger, "crawl").ok).toBe(true);
    expect(admit(ledger, "crawl")).toMatchObject({
      ok: false,
      reason: "probe-in-flight",
    });
    // Realtime probes alongside the crawl's probe; a second realtime waits
    // for that realtime probe, as before.
    expect(admit(ledger, "realtime").ok).toBe(true);
    expect(admit(ledger, "realtime")).toMatchObject({
      ok: false,
      reason: "probe-in-flight",
    });
  });

  test("the crawl does not probe while a tracked probe is in flight", () => {
    const { ledger } = pod();
    expect(admit(ledger, "backfill").ok).toBe(true);
    expect(admit(ledger, "crawl")).toMatchObject({
      ok: false,
      reason: "probe-in-flight",
    });
  });
});

describe("RiotBudgetLedger crawl 429 back-off", () => {
  test("a 429 on crawl traffic cools the crawl for Retry-After and never defers realtime", () => {
    const riot = new Riot();
    const { ledger, advance } = pod();
    send(ledger, riot, "realtime");
    advance(WINDOW_MS / 2);
    expect(
      ledger.admit({ route: ROUTE, method: METHOD, priority: "crawl" }).ok,
    ).toBe(true);
    ledger.observe(ROUTE, METHOD, limited(riot, "3"), "crawl");
    ledger.recordRateLimited(ROUTE, METHOD, limited(riot, "3"), "crawl");

    expect(
      ledger.admit({ route: ROUTE, method: METHOD, priority: "crawl" }),
    ).toEqual({ ok: false, waitMs: 3000, reason: "retry-after" });
    // Realtime is admitted at once: no cooldown, no single-probe wait.
    for (let index = 0; index < 5; index += 1) {
      expect(send(ledger, riot, "realtime")).toBe(true);
    }

    advance(3000);
    expect(send(ledger, riot, "crawl")).toBe(true);
  });

  test("after a crawl 429 only the crawl re-probes; realtime never waits on that probe", () => {
    const riot = new Riot();
    const { ledger, advance } = pod();
    send(ledger, riot, "crawl");
    ledger.admit({ route: ROUTE, method: METHOD, priority: "crawl" });
    ledger.observe(ROUTE, METHOD, limited(riot, "1"), "crawl");
    ledger.recordRateLimited(ROUTE, METHOD, limited(riot, "1"), "crawl");
    advance(1000);

    expect(
      ledger.admit({ route: ROUTE, method: METHOD, priority: "crawl" }).ok,
    ).toBe(true);
    expect(
      ledger.admit({ route: ROUTE, method: METHOD, priority: "crawl" }),
    ).toMatchObject({ ok: false, reason: "probe-in-flight" });
    expect(
      ledger.admit({ route: ROUTE, method: METHOD, priority: "realtime" }).ok,
    ).toBe(true);
  });

  test("a crawl 429 without Retry-After uses the default cooldown", () => {
    const riot = new Riot();
    const { ledger } = pod();
    send(ledger, riot, "crawl");
    ledger.recordRateLimited(ROUTE, METHOD, limited(riot), "crawl");
    expect(
      ledger.admit({ route: ROUTE, method: METHOD, priority: "crawl" }),
    ).toEqual({
      ok: false,
      waitMs: DEFAULT_RIOT_BUDGET_CONFIG.defaultRetryAfterMs,
      reason: "retry-after",
    });
  });

  test("a 429 on tracked traffic holds the crawl too", () => {
    const riot = new Riot();
    const { ledger } = pod();
    send(ledger, riot, "realtime");
    ledger.recordRateLimited(ROUTE, METHOD, limited(riot, "2"), "realtime");
    for (const priority of ["realtime", "crawl"] as const) {
      expect(
        ledger.admit({ route: ROUTE, method: METHOD, priority }),
      ).toMatchObject({ ok: false, reason: "retry-after" });
    }
  });
});

const MATCH_URL =
  "https://americas.api.riotgames.com/lol/match/v5/matches/NA1_1";

function runtime() {
  const sleeps: number[] = [];
  return {
    sleeps,
    runtime: {
      now: () => 0,
      random: () => 0,
      sleep: (milliseconds: number) => {
        sleeps.push(milliseconds);
        return Promise.resolve();
      },
    },
  };
}

describe("RateLimiter with a shared ledger", () => {
  test("a crawl 429 backs the crawl off and never delays a realtime request", async () => {
    const riot = new Riot();
    riot.count = 100;
    let now = 0;
    const ledger = new RiotBudgetLedger({ clock: () => now });
    const crawlSide = runtime();
    const trackedSide = runtime();
    const crawlLimiter = new RateLimiter(
      { concurrency: 2, reservedRealtimeSlots: 0, maxRetries: 0, ledger },
      crawlSide.runtime,
    );
    const trackedLimiter = new RateLimiter(
      { concurrency: 5, maxRetries: 0, ledger, budgetMode: () => "enforce" },
      trackedSide.runtime,
    );
    const crawlOptions = {
      priority: "crawl",
      maxRetries: 0,
      refuseOverBudget: true,
    } as const;
    let sent = 0;
    const respond =
      (status: number, extra: Record<string, string> = {}) =>
      () => {
        sent += 1;
        return Promise.resolve(
          new Response("{}", { status, headers: riot.headers(extra) }),
        );
      };

    // Learn the window, then the crawl's next request is rate limited.
    await trackedLimiter.execute(MATCH_URL, respond(200));
    now = WINDOW_MS / 2; // far enough into the window for the paced crawl
    await expect(
      crawlLimiter.execute(
        MATCH_URL,
        respond(429, {
          "x-rate-limit-type": "application",
          "retry-after": "5",
        }),
        crawlOptions,
      ),
    ).rejects.toBeInstanceOf(RiotHttpError);

    // The crawl is refused without sending, so the tick can stop.
    const sentBefore = sent;
    await expect(
      crawlLimiter.execute(MATCH_URL, respond(200), crawlOptions),
    ).rejects.toBeInstanceOf(RiotBudgetRefusedError);
    expect(sent).toBe(sentBefore);

    // Realtime, on the tracked limiter in enforce mode, goes straight out.
    await trackedLimiter.execute(MATCH_URL, respond(200), {
      priority: "realtime",
    });
    expect(sent).toBe(sentBefore + 1);
    expect(trackedSide.sleeps).toEqual([]);
    expect(crawlSide.sleeps).toEqual([]);
  });

  test("a crawl request over budget is refused, not sent, even in observe mode", async () => {
    const riot = new Riot();
    riot.count = 300;
    const ledger = new RiotBudgetLedger({ clock: () => 0 });
    const { runtime: crawlRuntime } = runtime();
    const limiter = new RateLimiter(
      { ledger, budgetMode: () => "observe", maxRetries: 0 },
      crawlRuntime,
    );
    let sent = 0;
    const fetchOk = () => {
      sent += 1;
      return Promise.resolve(Response.json({}, { headers: riot.headers() }));
    };
    await limiter.execute(MATCH_URL, fetchOk);
    // 300 of 1000 is over the default 0.25 crawl target.
    const refusal = limiter.execute(MATCH_URL, fetchOk, {
      priority: "crawl",
      refuseOverBudget: true,
    });
    await expect(refusal).rejects.toMatchObject({
      name: "RiotBudgetRefusedError",
      reason: "app-window",
    });
    expect(sent).toBe(1);
  });

  test("publishes total utilisation everywhere and the crawl share only where it is exact", async () => {
    const riot = new Riot();
    riot.count = 420;
    const attributedLedger = new RiotBudgetLedger({ clock: () => 0 });
    const attributed = new RateLimiter(
      { ledger: attributedLedger, maxRetries: 0 },
      runtime().runtime,
    );
    await attributed.execute(
      "https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_1",
      () => Promise.resolve(Response.json({}, { headers: riot.headers() })),
    );
    const unattributed = new RateLimiter(
      {
        ledger: new RiotBudgetLedger({
          clock: () => 0,
          crawl: { target: () => 0.5, enabled: () => true, attributed: false },
        }),
        maxRetries: 0,
      },
      runtime().runtime,
    );
    await unattributed.execute(
      "https://asia.api.riotgames.com/lol/match/v5/matches/KR_1",
      () => Promise.resolve(Response.json({}, { headers: riot.headers() })),
    );

    const utilisationMetric = await riotApiAppWindowUtilisationRatio.get();
    const shareMetric = await riotApiAppWindowCrawlShareRatio.get();
    const utilisation = utilisationMetric.values;
    const share = shareMetric.values;
    const forRoute = (
      values: typeof utilisation,
      route: string,
    ): number | undefined =>
      values.find((value) => value.labels.route === route)?.value;
    expect(forRoute(utilisation, "europe")).toBe(0.42);
    expect(forRoute(utilisation, "asia")).toBe(0.42);
    expect(forRoute(share, "europe")).toBe(0);
    expect(forRoute(share, "asia")).toBeUndefined();
  });
});
