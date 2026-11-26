/**
 * Discrete-event simulation of Riot's rate windows on a virtual clock, for the
 * budget ledger's simulation tests and the crawl-target demo. No timers and no
 * sleeping: `Simulation` orders events, `FakeRiot` enforces fixed windows per
 * route like the production key (500/10s and 30,000/600s) and answers in
 * Riot's real header format, and each `Pod` is one process's ledger.
 */
import {
  RiotBudgetLedger,
  type RiotCrawlBudget,
  type RiotPriority,
} from "#src/league/api/client/rate-budget.ts";

export const ROUTE = "americas";
export const LATENCY_MS = 50;
export const APP_WINDOWS = [
  { seconds: 10, limit: 500 },
  { seconds: 600, limit: 30_000 },
];

type Event = { at: number; seq: number; run: () => void };

export class Simulation {
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

export type ForcedRateLimit = {
  from: number;
  until: number;
  type: "application" | "method" | "service";
  retryAfterSeconds: number;
  method?: string;
};

export type RiotResponse = { status: 200 | 429; headers: Headers };

function newWindow(): Window {
  return { start: 0, count: 0, bySource: new Map() };
}

export class FakeRiot {
  readonly peakBySource = new Map<string, Map<string, number>>();
  readonly rejected: { source: string; at: number }[] = [];
  /** The highest count each app window reported, as its count header would show. */
  readonly peakAppCount: number[] = [0, 0];
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

    this.appState.forEach((state, index) => {
      this.take(state, source);
      this.peakAppCount[index] = Math.max(
        this.peakAppCount[index] ?? 0,
        state.count,
      );
    });
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

export type Send = {
  at: number;
  priority: RiotPriority;
  method: string;
  status: 200 | 429;
  respondedAt: number;
};

export class Pod {
  readonly ledger: RiotBudgetLedger;
  readonly sends: Send[] = [];

  constructor(
    private readonly sim: Simulation,
    private readonly riot: FakeRiot,
    private readonly name: string,
    crawl?: RiotCrawlBudget,
  ) {
    this.ledger = new RiotBudgetLedger({
      clock: () => sim.now,
      ...(crawl === undefined ? {} : { crawl }),
    });
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
      this.ledger.observe(ROUTE, method, response.headers, priority);
      if (response.status === 429) {
        this.ledger.recordRateLimited(
          ROUTE,
          method,
          response.headers,
          priority,
        );
      }
      this.sends.push({
        at: sentAt,
        priority,
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
    this.startSaturating("crawl", workers, methods);
  }

  /** Infinite demand at `priority`: `workers` concurrent loops, methods round-robin. */
  startSaturating(
    priority: RiotPriority,
    workers: number,
    methods: string[],
  ): void {
    let turn = 0;
    const loop = (): void => {
      // Try each method in rotation; a refused method must not block the rest.
      let shortestWait = Infinity;
      for (let offset = 0; offset < methods.length; offset += 1) {
        const method = methods[(turn + offset) % methods.length] ?? "match";
        const wait = this.trySend(priority, method, loop);
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
    this.startBursts("realtime", burst, waits);
  }

  /**
   * Bursts at `priority`: `size` simultaneous requests every `periodMs`, each
   * retried until admitted; `waits` collects how long each waited.
   */
  startBursts(
    priority: RiotPriority,
    burst: { size: number; periodMs: number; offsetMs: number; endMs: number },
    waits: number[],
    /** When given, each request's arrival, index-aligned with `waits`. */
    arrivals?: number[],
  ): void {
    const { size, periodMs, offsetMs, endMs } = burst;
    for (let at = offsetMs; at < endMs; at += periodMs) {
      for (let request = 0; request < size; request += 1) {
        this.sim.at(at, () => {
          const arrival = this.sim.now;
          const attempt = (): void => {
            const wait = this.trySend(priority, "match");
            if (wait === undefined) {
              waits.push(this.sim.now - arrival);
              arrivals?.push(arrival);
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

/**
 * A crawl-target scenario on the production key's windows, starting from a
 * restart (every ledger empty). The activity worker (crawl attributed) runs a
 * realtime baseline, a little backfill and an infinite-demand crawl; the
 * application pod (crawl not attributed) sends interactive bursts. The first
 * realtime burst lands at the instant the crawl starts. `crawlOff` runs the
 * same tracked traffic with no crawl, as the startup baseline. `trackedOnly`
 * drops realtime and instead saturates backfill and interactive in both pods,
 * to find the highest count Riot reports while only non-realtime classes
 * compete with the crawl.
 */
export type CrawlTargetScenario = {
  target: number;
  minutes: number;
  trackedOnly?: boolean;
  crawlOff?: boolean;
};

const SUMMARY_KEYS = [
  "realtime",
  "interactive",
  "backfill",
  "crawl",
  "total",
] as const;

export type CrawlTargetSummary = {
  target: number;
  /** Requests per class per window, averaged over the run's whole windows. */
  perWindow: Record<
    "10" | "600",
    Record<(typeof SUMMARY_KEYS)[number], number>
  >;
  /** Highest count/limit Riot reported in each window. */
  peakUtilisation: Record<"10" | "600", number>;
  rejected: number;
  realtimeDeferred: number;
  realtimeMaxWaitMs: number;
  /** Realtime requests that waited, among those arriving in the first minute. */
  startupRealtimeDeferred: number;
  /** Classes of the responses that arrived first after the restart. */
  firstResponders: RiotPriority[];
};

function appLimit(index: number): number {
  return APP_WINDOWS[index]?.limit ?? 1;
}

export function simulateCrawlTarget(
  scenario: CrawlTargetScenario,
): CrawlTargetSummary {
  const sim = new Simulation();
  const riot = new FakeRiot(
    new Map([["timeline", { seconds: 10, limit: 100 }]]),
  );
  const crawl = (attributed: boolean): RiotCrawlBudget => ({
    target: () => scenario.target,
    enabled: () => scenario.crawlOff !== true,
    attributed,
  });
  const worker = new Pod(sim, riot, "worker", crawl(true));
  const app = new Pod(sim, riot, "app", crawl(false));
  const endMs = scenario.minutes * 60_000;
  const waits: number[] = [];
  const arrivals: number[] = [];
  if (scenario.crawlOff !== true) {
    worker.startSaturating("crawl", 8, ["match", "timeline", "league"]);
  }
  if (scenario.trackedOnly === true) {
    worker.startSaturating("backfill", 4, ["match", "timeline"]);
    app.startSaturating("interactive", 4, ["match", "timeline"]);
    app.startSaturating("backfill", 4, ["match"]);
  } else {
    // 25 realtime every 5 s is 5 rps: 10% of the 50 rps key.
    const burst = (size: number, periodMs: number, offsetMs: number) => ({
      size,
      periodMs,
      offsetMs,
      endMs,
    });
    worker.startBursts("realtime", burst(25, 5000, 0), waits, arrivals);
    worker.startBursts("backfill", burst(5, 10_000, 2501), []);
    app.startBursts("interactive", burst(10, 10_000, 4007), []);
  }
  sim.runUntil(endMs);

  const sends = [...worker.sends, ...app.sends].filter(
    (send) => send.status === 200,
  );
  const perWindow = (seconds: number) => {
    const windows = Math.floor(endMs / (seconds * 1000));
    const counts = {
      realtime: 0,
      interactive: 0,
      backfill: 0,
      crawl: 0,
      total: 0,
    };
    for (const send of sends) {
      if (send.at >= windows * seconds * 1000) continue;
      counts[send.priority] += 1;
      counts.total += 1;
    }
    for (const key of SUMMARY_KEYS) {
      counts[key] = Math.round(counts[key] / windows);
    }
    return counts;
  };

  const all = [...worker.sends, ...app.sends];
  const firstAt = Math.min(...all.map((send) => send.respondedAt));
  return {
    target: scenario.target,
    perWindow: { "10": perWindow(10), "600": perWindow(600) },
    peakUtilisation: {
      "10": (riot.peakAppCount[0] ?? 0) / appLimit(0),
      "600": (riot.peakAppCount[1] ?? 0) / appLimit(1),
    },
    rejected: riot.rejected.length,
    realtimeDeferred: waits.filter((wait) => wait > 0).length,
    realtimeMaxWaitMs: waits.length === 0 ? 0 : Math.max(...waits),
    startupRealtimeDeferred: waits.filter(
      (wait, index) => wait > 0 && (arrivals[index] ?? Infinity) < 60_000,
    ).length,
    firstResponders: all
      .filter((send) => send.respondedAt === firstAt)
      .map((send) => send.priority)
      .sort(),
  };
}
