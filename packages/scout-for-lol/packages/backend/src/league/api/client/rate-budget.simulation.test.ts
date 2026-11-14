import { describe, expect, test } from "vitest";
import {
  DEFAULT_RIOT_BUDGET_CONFIG,
  RiotBudgetLedger,
  type RiotPriority,
} from "./rate-budget.ts";
import { RateLimiter } from "./rate-limiter.ts";

/**
 * Discrete-event simulation on a virtual clock: no timers, no sleeping. A fake
 * Riot enforces fixed windows per route (500/10s and 30,000/600s, like the
 * production key) and answers in Riot's real header format. Two ledgers share
 * it, one per pod: one sends realtime bursts, the other crawls with infinite
 * demand.
 */

const ROUTE = "americas";
const LATENCY_MS = 50;
const APP_WINDOWS = [
  { seconds: 10, limit: 500 },
  { seconds: 600, limit: 30_000 },
];

type Event = { at: number; seq: number; run: () => void };

class Simulation {
  now = 0;
  private seq = 0;
  private readonly heap: Event[] = [];

  at(at: number, run: () => void): void {
    const event = { at, seq: this.seq++, run };
    this.heap.push(event);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentEvent = this.heap[parent];
      if (parentEvent === undefined || !this.before(event, parentEvent)) {
        break;
      }
      this.heap[index] = parentEvent;
      index = parent;
    }
    this.heap[index] = event;
  }

  runUntil(end: number): void {
    for (;;) {
      const next = this.heap[0];
      if (next === undefined || next.at > end) {
        break;
      }
      const last = this.heap.pop();
      if (last !== undefined && this.heap.length > 0) {
        this.siftDown(last);
      }
      this.now = next.at;
      next.run();
    }
    this.now = end;
  }

  private before(a: Event, b: Event): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  private siftDown(event: Event): void {
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = event;
      let smallestIndex = index;
      const leftEvent = this.heap[left];
      if (leftEvent !== undefined && this.before(leftEvent, smallest)) {
        smallest = leftEvent;
        smallestIndex = left;
      }
      const rightEvent = this.heap[right];
      if (rightEvent !== undefined && this.before(rightEvent, smallest)) {
        smallest = rightEvent;
        smallestIndex = right;
      }
      if (smallestIndex === index) {
        break;
      }
      this.heap[index] = smallest;
      index = smallestIndex;
    }
    this.heap[index] = event;
  }
}

type Window = {
  start: number;
  count: number;
  bySource: Map<string, number>;
};

type ForcedRateLimit = {
  from: number;
  until: number;
  type: "application" | "method" | "service";
  retryAfterSeconds: number;
  method?: string;
};

type RiotResponse = { status: 200 | 429; headers: Headers };

function newWindow(): Window {
  return { start: 0, count: 0, bySource: new Map() };
}

class FakeRiot {
  readonly peakBySource = new Map<string, Map<string, number>>();
  readonly rejected: { source: string; at: number }[] = [];
  forced: ForcedRateLimit | undefined;
  private readonly appState = [newWindow(), newWindow()];
  private readonly methodState = new Map<string, Window>();

  constructor(
    private readonly methodLimits: Map<
      string,
      { seconds: number; limit: number }
    > = new Map(),
  ) {}

  handle(source: string, method: string, now: number): RiotResponse {
    const methodLimit = this.methodLimits.get(method);
    const methodWindow =
      methodLimit === undefined
        ? undefined
        : this.refresh(this.methodState, method, methodLimit.seconds, now);
    this.appState.forEach((state, index) => {
      this.rollover(state, APP_WINDOWS[index]?.seconds ?? 0, now);
    });

    const forced = this.forced;
    const isForced =
      forced !== undefined &&
      now >= forced.from &&
      now < forced.until &&
      (forced.method === undefined || forced.method === method);
    const appFull = this.appState.some(
      (state, index) => state.count + 1 > (APP_WINDOWS[index]?.limit ?? 0),
    );
    const methodFull =
      methodWindow !== undefined &&
      methodLimit !== undefined &&
      methodWindow.count + 1 > methodLimit.limit;

    if (isForced || appFull || methodFull) {
      this.rejected.push({ source, at: now });
      const type = isForced ? forced.type : appFull ? "application" : "method";
      const headers = this.headers(methodLimit, methodWindow);
      headers.set("x-rate-limit-type", type);
      headers.set(
        "retry-after",
        String(isForced ? forced.retryAfterSeconds : 1),
      );
      return { status: 429, headers };
    }

    for (const state of this.appState) {
      this.take(state, source);
    }
    if (methodWindow !== undefined) {
      methodWindow.count += 1;
    }
    this.appState.forEach((state, index) => {
      const seconds = APP_WINDOWS[index]?.seconds ?? 0;
      const peaks = this.peakBySource.get(source) ?? new Map<string, number>();
      const key = `app:${String(seconds)}`;
      peaks.set(
        key,
        Math.max(peaks.get(key) ?? 0, state.bySource.get(source) ?? 0),
      );
      this.peakBySource.set(source, peaks);
    });
    if (methodLimit !== undefined && methodWindow !== undefined) {
      const peaks = this.peakBySource.get(`${source}:${method}`) ?? new Map();
      peaks.set(
        "method",
        Math.max(peaks.get("method") ?? 0, methodWindow.count),
      );
      this.peakBySource.set(`${source}:${method}`, peaks);
    }
    return { status: 200, headers: this.headers(methodLimit, methodWindow) };
  }

  private take(state: Window, source: string): void {
    state.count += 1;
    state.bySource.set(source, (state.bySource.get(source) ?? 0) + 1);
  }

  private rollover(state: Window, seconds: number, now: number): void {
    // Like Riot, a window starts at its first request and ends `seconds` later.
    if (state.count === 0 || now >= state.start + seconds * 1000) {
      state.start = now;
      state.count = 0;
      state.bySource = new Map();
    }
  }

  private refresh(
    states: Map<string, Window>,
    key: string,
    seconds: number,
    now: number,
  ): Window {
    const state = states.get(key) ?? {
      start: now,
      count: 0,
      bySource: new Map(),
    };
    this.rollover(state, seconds, now);
    states.set(key, state);
    return state;
  }

  private headers(
    methodLimit: { seconds: number; limit: number } | undefined,
    methodWindow: Window | undefined,
  ): Headers {
    const headers = new Headers({
      "x-app-rate-limit": APP_WINDOWS.map(
        (window) => `${String(window.limit)}:${String(window.seconds)}`,
      ).join(","),
      "x-app-rate-limit-count": this.appState
        .map(
          (state, index) =>
            `${String(state.count)}:${String(APP_WINDOWS[index]?.seconds)}`,
        )
        .join(","),
    });
    if (methodLimit !== undefined && methodWindow !== undefined) {
      headers.set(
        "x-method-rate-limit",
        `${String(methodLimit.limit)}:${String(methodLimit.seconds)}`,
      );
      headers.set(
        "x-method-rate-limit-count",
        `${String(methodWindow.count)}:${String(methodLimit.seconds)}`,
      );
    }
    return headers;
  }
}

type Send = {
  at: number;
  method: string;
  status: 200 | 429;
  respondedAt: number;
};

class Pod {
  readonly ledger: RiotBudgetLedger;
  readonly sends: Send[] = [];

  constructor(
    private readonly sim: Simulation,
    private readonly riot: FakeRiot,
    private readonly name: string,
  ) {
    this.ledger = new RiotBudgetLedger({ clock: () => sim.now });
  }

  /** Tries to send now; returns the wait in ms when the ledger refuses. */
  trySend(
    priority: RiotPriority,
    method: string,
    onResponse?: (status: 200 | 429) => void,
  ): number | undefined {
    const decision = this.ledger.admit({ route: ROUTE, method, priority });
    if (!decision.ok) {
      return decision.waitMs;
    }
    const sentAt = this.sim.now;
    let response: RiotResponse | undefined;
    this.sim.at(sentAt + LATENCY_MS / 2, () => {
      response = this.riot.handle(this.name, method, this.sim.now);
    });
    this.sim.at(sentAt + LATENCY_MS, () => {
      if (response === undefined) {
        throw new Error("response event ran before the request event");
      }
      this.ledger.observe(ROUTE, method, response.headers);
      if (response.status === 429) {
        this.ledger.recordRateLimited(ROUTE, method, response.headers);
      }
      this.sends.push({
        at: sentAt,
        method,
        status: response.status,
        respondedAt: this.sim.now,
      });
      onResponse?.(response.status);
    });
    return undefined;
  }

  /** Infinite-demand crawl: `workers` concurrent loops, methods round-robin. */
  startCrawl(workers: number, methods: string[]): void {
    let turn = 0;
    const loop = (): void => {
      // Try each method in rotation; a refused method must not block the rest.
      let shortestWait = Infinity;
      for (let offset = 0; offset < methods.length; offset += 1) {
        const method = methods[(turn + offset) % methods.length] ?? "match";
        const wait = this.trySend("crawl", method, loop);
        if (wait === undefined) {
          turn += offset + 1;
          return;
        }
        shortestWait = Math.min(shortestWait, wait);
      }
      this.sim.at(this.sim.now + Math.max(1, shortestWait), loop);
    };
    for (let worker = 0; worker < workers; worker += 1) {
      this.sim.at(0, loop);
    }
  }

  /** Realtime bursts: `size` simultaneous requests every `periodMs`. */
  startRealtimeBursts(
    burst: { size: number; periodMs: number; offsetMs: number; endMs: number },
    waits: number[],
  ): void {
    const { size, periodMs, offsetMs, endMs } = burst;
    for (let at = offsetMs; at < endMs; at += periodMs) {
      for (let request = 0; request < size; request += 1) {
        this.sim.at(at, () => {
          const arrival = this.sim.now;
          const attempt = (): void => {
            const wait = this.trySend("realtime", "match");
            if (wait === undefined) {
              waits.push(this.sim.now - arrival);
            } else {
              this.sim.at(this.sim.now + Math.max(1, wait), attempt);
            }
          };
          attempt();
        });
      }
    }
  }
}

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

    crawlPod.startCrawl(5, ["match", "timeline"]);
    realtimePod.startRealtimeBursts(
      { size: 150, periodMs: 10 * SECOND, offsetMs: 3 * SECOND, endMs: END },
      waits,
    );
    sim.runUntil(END + 60 * SECOND);

    expect(riot.rejected).toEqual([]);
    expect(waits.length).toBe(
      150 * Math.ceil((END - 3 * SECOND) / (10 * SECOND)),
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
    ledger.observe(ROUTE, "match", appHeaders(1));
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
      const { ledger } = setup();
      ledger.admit(input("realtime"));
      ledger.observe(ROUTE, "match", appHeaders(cap - 1));
      expect(ledger.admit(input(priority)).ok).toBe(true);
      ledger.observe(ROUTE, "match", appHeaders(cap));
      expect(ledger.admit(input(priority)).ok).toBe(false);
    }
  });

  test("stale headers fall back to a single probe instead of trusting old counts", () => {
    const { ledger, advance } = setup();
    ledger.admit(input("realtime"));
    ledger.observe(ROUTE, "match", appHeaders(490));
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
    ledger.observe(ROUTE, "match", appHeaders(125));
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
    ledger.observe(ROUTE, "match", headers);
    ledger.recordRateLimited(ROUTE, "match", headers);

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
    ledger.observe(ROUTE, "slow", headers);
    ledger.recordRateLimited(ROUTE, "slow", headers);

    expect(ledger.admit(input("realtime", "slow"))).toMatchObject({
      ok: false,
      reason: "retry-after",
    });
    ledger.admit(input("realtime", "fast"));
    ledger.observe(ROUTE, "fast", appHeaders(10));
    expect(ledger.admit(input("realtime", "fast"))).toEqual({ ok: true });
  });

  test("a service 429 is not a budget signal", () => {
    const { ledger } = setup();
    ledger.admit(input("realtime"));
    const headers = appHeaders(10, {
      "x-rate-limit-type": "service",
      "retry-after": "30",
    });
    ledger.observe(ROUTE, "match", headers);
    ledger.recordRateLimited(ROUTE, "match", headers);
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
  });

  test("abandoning a probe frees the route for another", () => {
    const { ledger } = setup();
    ledger.admit(input("realtime"));
    ledger.abandon(ROUTE, "match");
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
  });

  test("a probe response without app headers keeps the route unlearned", () => {
    const { ledger } = setup();
    expect(ledger.admit(input("realtime"))).toEqual({ ok: true });
    ledger.observe(ROUTE, "match", new Headers());
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
