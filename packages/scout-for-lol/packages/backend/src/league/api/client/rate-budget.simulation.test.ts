import { describe, expect, test } from "vitest";
import {
  FakeRiot,
  Pod,
  ROUTE,
  Simulation,
} from "#src/testing/riot-rate-simulation.ts";
import {
  DEFAULT_RIOT_BUDGET_CONFIG,
  RiotBudgetLedger,
  type RiotPriority,
} from "./rate-budget.ts";
import { RateLimiter } from "./rate-limiter.ts";

/**
 * Two ledgers share one fake Riot, one per pod: one sends realtime bursts, the
 * other crawls with infinite demand.
 */

const SECOND = 1000;
const END = 1800 * SECOND;
const CRAWL_CEILING = DEFAULT_RIOT_BUDGET_CONFIG.ceilings.crawl;

describe("RiotBudgetLedger simulation", () => {
  test("realtime bursts are never starved or 429'd by an infinite crawl", () => {
    const sim = new Simulation();
    const riot = new FakeRiot();
    const realtimePod = new Pod(sim, riot, "realtime");
    const crawlPod = new Pod(sim, riot, "crawl");
    const waits: number[] = [];

    // Realtime at 20% of the key leaves the crawl 5% of its 25% target.
    crawlPod.startCrawl(5, ["match", "timeline"]);
    realtimePod.startRealtimeBursts(
      { size: 100, periodMs: 10 * SECOND, offsetMs: 3 * SECOND, endMs: END },
      waits,
    );
    sim.runUntil(END + 60 * SECOND);

    expect(riot.rejected).toEqual([]);
    expect(waits.length).toBe(
      100 * Math.ceil((END - 3 * SECOND) / (10 * SECOND)),
    );
    expect(Math.max(...waits)).toBeLessThanOrEqual(1000);

    const crawlPeaks = riot.peakBySource.get("crawl");
    expect(crawlPeaks?.get("app:10")).toBeLessThanOrEqual(
      Math.floor(CRAWL_CEILING * 500),
    );
    expect(crawlPeaks?.get("app:600")).toBeLessThanOrEqual(
      Math.floor(CRAWL_CEILING * 30_000),
    );
    expect(crawlPod.sends.length).toBeGreaterThan(1000);
  });

  test("crawl reaches 90% of its ceiling while realtime is idle", () => {
    const sim = new Simulation();
    const riot = new FakeRiot();
    const crawlPod = new Pod(sim, riot, "crawl");

    crawlPod.startCrawl(5, ["match"]);
    sim.runUntil(END);

    const ceilingRequests = (CRAWL_CEILING * 30_000 * END) / (600 * SECOND);
    expect(crawlPod.sends.length).toBeGreaterThanOrEqual(0.9 * ceilingRequests);
    expect(crawlPod.sends.length).toBeLessThanOrEqual(ceilingRequests);
    expect(riot.rejected).toEqual([]);
  });

  test("an injected application 429 pauses every send, then resumes with one probe", () => {
    const sim = new Simulation();
    const riot = new FakeRiot();
    const crawlPod = new Pod(sim, riot, "crawl");
    riot.forced = {
      from: 100 * SECOND,
      until: 105 * SECOND,
      type: "application",
      retryAfterSeconds: 5,
    };

    crawlPod.startCrawl(5, ["match"]);
    sim.runUntil(130 * SECOND);

    const limited = crawlPod.sends.filter((send) => send.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited.length).toBeLessThanOrEqual(5);
    const lastResponse = Math.max(...limited.map((send) => send.respondedAt));
    const firstResponse = Math.min(...limited.map((send) => send.respondedAt));

    const during = crawlPod.sends.filter(
      (send) => send.at > lastResponse && send.at < firstResponse + 5 * SECOND,
    );
    expect(during).toEqual([]);

    const after = crawlPod.sends.filter(
      (send) => send.at >= firstResponse + 5 * SECOND,
    );
    expect(after.length).toBeGreaterThan(0);
    const probe = after[0];
    const second = after[1];
    expect(probe?.status).toBe(200);
    // The second request waits for the probe's response.
    expect(second?.at).toBeGreaterThanOrEqual(probe?.respondedAt ?? Infinity);
  });

  test("a method limit caps that method only and never 429s", () => {
    const sim = new Simulation();
    const riot = new FakeRiot(new Map([["slow", { seconds: 10, limit: 20 }]]));
    const crawlPod = new Pod(sim, riot, "crawl");

    crawlPod.startCrawl(5, ["slow", "fast"]);
    sim.runUntil(300 * SECOND);

    expect(riot.rejected).toEqual([]);
    expect(
      riot.peakBySource.get("crawl:slow")?.get("method"),
    ).toBeLessThanOrEqual(Math.floor(CRAWL_CEILING * 20));
    const fast = crawlPod.sends.filter((send) => send.method === "fast");
    expect(fast.length).toBeGreaterThan(1000);
  });
});

function setup() {
  let now = 0;
  const ledger = new RiotBudgetLedger({ clock: () => now });
  return {
    ledger,
    advance: (to: number) => {
      now = to;
    },
  };
}

function appHeaders(count: number, extra: Record<string, string> = {}) {
  return new Headers({
    "x-app-rate-limit": "500:10,30000:600",
    "x-app-rate-limit-count": `${String(count)}:10,${String(count)}:600`,
    ...extra,
  });
}

const input = (priority: RiotPriority, method = "match") => ({
  route: ROUTE,
  method,
  priority,
});

describe("RiotBudgetLedger", () => {
  test("slow start allows a single probe on a route with no response", () => {
    const { ledger } = setup();
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
    expect(ledger.admit(input("realtime"))).toEqual({
      ok: false,
      waitMs: DEFAULT_RIOT_BUDGET_CONFIG.probeWaitMs,
      reason: "probe-in-flight",
    });
    ledger.observe(ROUTE, "match", appHeaders(1), "realtime");
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
  });

  test("each class stops at its own ceiling of the limit", () => {
    // floor(0.25 * 500) = 125, 0.6 -> 300, 0.85 -> 425, 0.95 -> 475
    const caps: [RiotPriority, number][] = [
      ["crawl", 125],
      ["backfill", 300],
      ["interactive", 425],
      ["realtime", 475],
    ];
    for (const [priority, cap] of caps) {
      const { ledger, advance } = setup();
      ledger.admit(input("realtime"));
      ledger.observe(ROUTE, "match", appHeaders(cap - 1), "realtime");
      // The crawl is paced through each window; near the short window's end
      // it may have reached its whole ceiling.
      advance(10 * SECOND - 1);
      expect(ledger.admit(input(priority)).ok).toBe(true);
      ledger.observe(ROUTE, "match", appHeaders(cap), "realtime");
      expect(ledger.admit(input(priority)).ok).toBe(false);
    }
  });

  test("stale headers fall back to a single probe instead of trusting old counts", () => {
    const { ledger, advance } = setup();
    ledger.admit(input("realtime"));
    ledger.observe(ROUTE, "match", appHeaders(490), "realtime");
    expect(ledger.admit(input("realtime")).ok).toBe(false);

    // The 10s window has certainly rolled over; the 490 means nothing now.
    advance(11 * SECOND);
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
    expect(ledger.admit(input("realtime"))).toMatchObject({
      ok: false,
      reason: "probe-in-flight",
    });
  });

  test("a full window reports when it can reopen", () => {
    const { ledger } = setup();
    ledger.admit(input("crawl"));
    ledger.observe(ROUTE, "match", appHeaders(125), "crawl");
    expect(ledger.admit(input("crawl"))).toEqual({
      ok: false,
      waitMs: 10 * SECOND,
      reason: "app-window",
    });
  });

  test("a 429 pauses the route until Retry-After, then resumes via a probe", () => {
    const { ledger, advance } = setup();
    ledger.admit(input("realtime"));
    const headers = appHeaders(100, {
      "x-rate-limit-type": "application",
      "retry-after": "4",
    });
    ledger.observe(ROUTE, "match", headers, "realtime");
    ledger.recordRateLimited(ROUTE, "match", headers, "realtime");

    advance(1 * SECOND);
    expect(ledger.admit(input("realtime"))).toEqual({
      ok: false,
      waitMs: 3 * SECOND,
      reason: "retry-after",
    });
    expect(ledger.admit(input("realtime", "other"))).toMatchObject({
      reason: "retry-after",
    });

    advance(4 * SECOND);
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
    expect(ledger.admit(input("realtime"))).toMatchObject({
      reason: "probe-in-flight",
    });
  });

  test("a method 429 blocks only that method", () => {
    const { ledger } = setup();
    ledger.admit(input("realtime", "slow"));
    const headers = appHeaders(10, {
      "x-rate-limit-type": "method",
      "retry-after": "5",
    });
    ledger.observe(ROUTE, "slow", headers, "realtime");
    ledger.recordRateLimited(ROUTE, "slow", headers, "realtime");

    expect(ledger.admit(input("realtime", "slow"))).toMatchObject({
      ok: false,
      reason: "retry-after",
    });
    ledger.admit(input("realtime", "fast"));
    ledger.observe(ROUTE, "fast", appHeaders(10), "realtime");
    expect(ledger.admit(input("realtime", "fast"))).toEqual({ ok: true });
  });

  test("a service 429 is not a budget signal", () => {
    const { ledger } = setup();
    ledger.admit(input("realtime"));
    const headers = appHeaders(10, {
      "x-rate-limit-type": "service",
      "retry-after": "30",
    });
    ledger.observe(ROUTE, "match", headers, "realtime");
    ledger.recordRateLimited(ROUTE, "match", headers, "realtime");
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
  });

  test("abandoning a probe frees the route for another", () => {
    const { ledger } = setup();
    ledger.admit(input("realtime"));
    ledger.abandon(ROUTE, "match", "realtime");
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
  });

  test("a probe response without app headers keeps the route unlearned", () => {
    const { ledger } = setup();
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
    ledger.observe(ROUTE, "match", new Headers(), "realtime");
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
    expect(ledger.admit(input("realtime"))).toEqual({
      ok: false,
      waitMs: DEFAULT_RIOT_BUDGET_CONFIG.probeWaitMs,
      reason: "probe-in-flight",
    });
  });
});

/**
 * The same virtual-clock idea applied to the real `RateLimiter`, which is
 * async: each timer fires only after every pending microtask has settled, so
 * the limiter's queueing runs exactly as it would in production, just without
 * waiting. Realtime arrives in bursts while backfill and crawl workers keep
 * every slot they can get busy.
 */
class AsyncClock {
  now = 0;
  private seq = 0;
  private timers: { at: number; seq: number; resolve: () => void }[] = [];

  readonly runtime = {
    now: (): number => this.now,
    random: (): number => 0,
    sleep: (milliseconds: number): Promise<void> =>
      new Promise<void>((resolve) => {
        this.timers.push({
          at: this.now + milliseconds,
          seq: this.seq++,
          resolve,
        });
      }),
  };

  async runUntil(end: number): Promise<void> {
    for (;;) {
      await new Promise((resolve) => setImmediate(resolve));
      let next: (typeof this.timers)[number] | undefined;
      for (const timer of this.timers) {
        if (
          next === undefined ||
          timer.at < next.at ||
          (timer.at === next.at && timer.seq < next.seq)
        ) {
          next = timer;
        }
      }
      if (next === undefined || next.at > end) {
        break;
      }
      const due = next;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.now = due.at;
      due.resolve();
    }
    this.now = end;
  }
}

const LIMITER_URL =
  "https://americas.api.riotgames.com/lol/match/v5/matches/NA1_1";
const LIMITER_LATENCY_MS = 50;
const LIMITER_END = 60 * SECOND;

async function simulateLimiter(scenario: {
  /** Priority given to the saturating background workers, or none. */
  background: { backfill: RiotPriority; crawl: RiotPriority } | undefined;
}): Promise<{ realtimeWaits: number[]; backgroundSends: number }> {
  const clock = new AsyncClock();
  const limiter = new RateLimiter(
    { concurrency: 5, maxRetries: 0, budgetMode: () => "observe" },
    clock.runtime,
  );
  const realtimeWaits: number[] = [];
  let backgroundSends = 0;
  const send = (priority: RiotPriority, onSent: () => void) =>
    limiter.execute(
      LIMITER_URL,
      async () => {
        onSent();
        await clock.runtime.sleep(LIMITER_LATENCY_MS);
        return new Response("ok");
      },
      { priority },
    );

  const runs: Promise<unknown>[] = [];
  const background = scenario.background;
  if (background !== undefined) {
    for (const priority of [background.backfill, background.crawl]) {
      for (let worker = 0; worker < 8; worker += 1) {
        runs.push(
          (async () => {
            while (clock.now < LIMITER_END) {
              await send(priority, () => {
                backgroundSends += 1;
              });
            }
          })(),
        );
      }
    }
  }

  // Ten realtime requests every two seconds, offset from the background start.
  for (let at = 1 * SECOND + 7; at < LIMITER_END; at += 2 * SECOND) {
    runs.push(
      (async () => {
        await clock.runtime.sleep(at);
        await Promise.all(
          Array.from({ length: 10 }, () => {
            const arrival = clock.now;
            return send("realtime", () => {
              realtimeWaits.push(clock.now - arrival);
            });
          }),
        );
      })(),
    );
  }

  await clock.runUntil(LIMITER_END + 10 * SECOND);
  await Promise.all(runs);
  return { realtimeWaits, backgroundSends };
}

function max(waits: number[]): number {
  return Math.max(...waits);
}

function mean(waits: number[]): number {
  return waits.reduce((sum, wait) => sum + wait, 0) / waits.length;
}

describe("RateLimiter priority simulation", () => {
  test("realtime wait is unchanged by saturating backfill and crawl", async () => {
    const idle = await simulateLimiter({ background: undefined });
    const saturated = await simulateLimiter({
      background: { backfill: "backfill", crawl: "crawl" },
    });
    // Without priorities: every caller tagged (or left) realtime, one FIFO.
    const fifo = await simulateLimiter({
      background: { backfill: "realtime", crawl: "realtime" },
    });

    const bursts = Math.ceil((LIMITER_END - SECOND) / (2 * SECOND));
    expect(idle.realtimeWaits).toHaveLength(10 * bursts);
    expect(saturated.realtimeWaits).toHaveLength(10 * bursts);

    // Idle: five slots serve a burst of ten in two waves.
    expect(max(idle.realtimeWaits)).toBe(LIMITER_LATENCY_MS);
    // Saturated: at worst one in-flight background request per slot finishes
    // first, so realtime never waits more than one extra request latency.
    expect(max(saturated.realtimeWaits)).toBeLessThanOrEqual(
      max(idle.realtimeWaits) + LIMITER_LATENCY_MS,
    );
    expect(mean(saturated.realtimeWaits)).toBeLessThanOrEqual(
      mean(idle.realtimeWaits) + LIMITER_LATENCY_MS,
    );
    // The background still ran nearly flat out on the slots realtime left.
    const capacity = (4 * LIMITER_END) / LIMITER_LATENCY_MS;
    expect(saturated.backgroundSends).toBeGreaterThan(0.8 * capacity);

    // And the classes are what bought that: one FIFO queue makes realtime
    // wait behind all sixteen background workers.
    expect(max(fifo.realtimeWaits)).toBeGreaterThan(
      2 * max(saturated.realtimeWaits),
    );
    expect(mean(fifo.realtimeWaits)).toBeGreaterThan(
      2 * mean(saturated.realtimeWaits),
    );
  });
});
