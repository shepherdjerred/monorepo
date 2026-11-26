import { beforeEach, describe, expect, test } from "vitest";
import {
  LeaguePuuidSchema,
  RiotMatchIdSchema,
  type LeaguePuuid,
  type RiotMatchId,
} from "@scout-for-lol/data";
import {
  RiotBudgetRefusedError,
  RiotHttpError,
} from "#src/league/api/client/errors.ts";
import { crawlBudgetRefusalsTotal } from "#src/metrics/crawl.ts";
import {
  CRAWL_MATCHES_PER_COMMIT,
  CRAWL_MAX_DEPTH,
  CRAWL_TICK_DEADLINE_MS,
  crawlCooldownEnd,
  puuidHash,
} from "./crawl-config.ts";
import type { CrawlRiotApi } from "./crawl-riot-client.ts";
import { runCrawlTick, type CrawlDeps } from "./crawl-run.ts";
import { bracketFromLeagueEntries } from "./crawl-visit.ts";
import { decodeSegment, type EncodedSegment } from "./crawl-segment.ts";
import {
  CrawlErasureFenceError,
  type CommitInput,
  type CrawlObjectStore,
  type CrawlStore,
  type FrontierPlayer,
  type NewFrontierPlayer,
  type SeedCursor,
  type TrackedObservation,
} from "./crawl-store.ts";

const NOW = new Date("2026-11-14T12:00:00Z");

/** A 78-character PUUID derived from a short readable name. */
const P = (name: string) => LeaguePuuidSchema.parse(name.padEnd(78, "x"));
const M = (id: string) => RiotMatchIdSchema.parse(id);
const unP = (puuid: string) => puuid.replace(/x+$/u, "");

type FrontierRow = NewFrontierPlayer & {
  nextEligibleAt: Date;
  lastVisitedAt?: Date;
};

/** An in-memory CrawlStore that applies the same rules as the PostgreSQL one. */
class MemoryStore implements CrawlStore {
  frontier = new Map<string, FrontierRow>();
  matches = new Map<string, { crawledAt: Date; depth: number }>();
  segments: EncodedSegment[] = [];
  erased = new Set<string>();
  observations: TrackedObservation[] = [];
  cursor: SeedCursor = {
    observedAt: new Date(NOW.getTime() - 86_400_000),
    matchId: null,
  };
  commits: CommitInput[] = [];

  seedCursor() {
    return Promise.resolve(this.cursor);
  }
  observationsAfter(cursor: SeedCursor) {
    return Promise.resolve(
      this.observations.filter((o) => o.observedAt > cursor.observedAt),
    );
  }
  advanceSeedCursor(cursor: SeedCursor) {
    this.cursor = cursor;
    return Promise.resolve();
  }
  admit(players: readonly NewFrontierPlayer[], now: Date) {
    let admitted = 0;
    let erased = 0;
    for (const player of players) {
      if (player.depth > CRAWL_MAX_DEPTH) continue;
      if (this.erased.has(puuidHash(player.puuid))) {
        erased += 1;
        continue;
      }
      if (this.frontier.has(player.puuid)) continue;
      this.frontier.set(player.puuid, { ...player, nextEligibleAt: now });
      admitted += 1;
    }
    return Promise.resolve({ admitted, erased });
  }
  claimEligible(now: Date, limit: number): Promise<FrontierPlayer[]> {
    return Promise.resolve(
      [...this.frontier.values()]
        .filter((row) => row.nextEligibleAt <= now)
        .filter((row) => !this.erased.has(puuidHash(row.puuid)))
        .sort((a, b) => a.depth - b.depth)
        .slice(0, limit),
    );
  }
  erasedAmong(puuids: readonly LeaguePuuid[]) {
    return Promise.resolve(
      new Set(puuids.filter((p) => this.erased.has(puuidHash(p)))),
    );
  }
  unknownMatchIds(ids: readonly RiotMatchId[]) {
    return Promise.resolve(ids.filter((id) => !this.matches.has(id)));
  }
  matchesCrawledSince(since: Date) {
    return Promise.resolve(
      [...this.matches.values()].filter((m) => m.crawledAt >= since).length,
    );
  }
  deletions: string[] = [];
  /** Called between the tick's checks and its commit, as a concurrent erasure would land. */
  beforeCommit: (() => void) | undefined;

  erasureMark() {
    return Promise.resolve(this.erased.size);
  }
  queueObjectDeletions(keys: readonly string[]) {
    this.deletions.push(...keys);
    return Promise.resolve();
  }
  async commit(input: CommitInput) {
    this.beforeCommit?.();
    if (this.erased.size !== input.erasureMark) {
      throw new CrawlErasureFenceError();
    }
    this.commits.push(input);
    for (const { segment, matches } of input.segments) {
      this.segments.push(segment);
      for (const match of matches) {
        this.matches.set(match.riotMatchId, {
          crawledAt: input.now,
          depth: match.depth,
        });
      }
    }
    for (const visit of input.visits) {
      const row = this.frontier.get(visit.puuid);
      if (row !== undefined) {
        row.lastVisitedAt = input.now;
        row.nextEligibleAt = crawlCooldownEnd(input.now);
      }
    }
    await this.admit(input.children, input.now);
  }
  frontierSizeByDepth() {
    const sizes: Record<number, number> = {};
    for (const row of this.frontier.values()) {
      sizes[row.depth] = (sizes[row.depth] ?? 0) + 1;
    }
    return Promise.resolve(sizes);
  }
}

function rawMatch(
  matchId: string,
  over: {
    queueId?: number;
    mapId?: number;
    gameCreation?: number;
    participants?: string[];
  } = {},
) {
  return {
    metadata: { matchId },
    info: {
      queueId: over.queueId ?? 420,
      mapId: over.mapId ?? 11,
      gameCreation: over.gameCreation ?? NOW.getTime() - 3_600_000,
      participants: (over.participants ?? ["pa", "pb"]).map((puuid) => ({
        puuid: P(puuid),
      })),
    },
  };
}

function notFound() {
  return new RiotHttpError({
    status: 404,
    statusText: "Not Found",
    body: {},
    url: "https://x",
    headers: new Headers(),
  });
}

type RiotScript = {
  ids?: Record<string, string[]>;
  matches?: Record<string, unknown>;
  failMatchWith?: RiotHttpError;
  league?: unknown;
};

function fakeRiot(script: RiotScript): CrawlRiotApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    matchIds: (puuid, _route, params) => {
      calls.push(`ids:${unP(puuid)}:${params.queue.toString()}`);
      const ids =
        script.ids?.[`${unP(puuid)}:${params.queue.toString()}`] ?? [];
      return Promise.resolve(ids.map((id) => M(id)));
    },
    match: (matchId) => {
      calls.push(`match:${matchId}`);
      if (script.failMatchWith !== undefined)
        return Promise.reject(script.failMatchWith);
      const found = script.matches?.[matchId];
      return found === undefined
        ? Promise.reject(notFound())
        : Promise.resolve(found);
    },
    timeline: (matchId) => {
      calls.push(`timeline:${matchId}`);
      return Promise.resolve({
        info: {
          participants: [],
          frames: [{ timestamp: 0, participantFrames: {}, events: [] }],
        },
      });
    },
    leagueEntries: (puuid) => {
      calls.push(`league:${unP(puuid)}`);
      return Promise.resolve(script.league ?? []);
    },
  };
}

function objects(): CrawlObjectStore & {
  put: EncodedSegment[];
  texts: Map<string, string>;
} {
  const put: EncodedSegment[] = [];
  const texts = new Map<string, string>();
  return {
    put,
    texts,
    readText: (key) => {
      const text = texts.get(key);
      return text === undefined
        ? Promise.reject(new Error(`missing ${key}`))
        : Promise.resolve(text);
    },
    putSegment: (segment) => {
      put.push(segment);
      return Promise.resolve();
    },
  };
}

let store: MemoryStore;
let store2objects: ReturnType<typeof objects>;
let inboxed: { segment: EncodedSegment; committed: boolean }[];

function deps(
  riot: CrawlRiotApi,
  overrides: Partial<CrawlDeps> = {},
): CrawlDeps {
  return {
    store,
    riot,
    objects: store2objects,
    lakeInbox: (segment) => {
      inboxed.push({
        segment,
        committed: store.segments.some((s) => s.sha256 === segment.sha256),
      });
      return Promise.resolve();
    },
    now: () => NOW,
    sleep: () => Promise.resolve(),
    enabled: () => true,
    // Large enough that daily pacing never binds unless a test sets it.
    dailyMatchBudget: () => 1_000_000,
    ...overrides,
  };
}

function seedPlayer(puuid: string, depth = 0) {
  store.frontier.set(P(puuid), {
    puuid: P(puuid),
    platformRoute: "NA1",
    depth,
    seedMatchId: M("NA1_1"),
    nextEligibleAt: new Date(NOW.getTime() - 1000),
  });
}

beforeEach(() => {
  store = new MemoryStore();
  store2objects = objects();
  inboxed = [];
});

describe("runCrawlTick", () => {
  test("does nothing and touches nothing while disabled", async () => {
    const riot = fakeRiot({});
    seedPlayer("p1");
    const result = await runCrawlTick(deps(riot, { enabled: () => false }));
    expect(result.status).toBe("disabled");
    expect(riot.calls).toEqual([]);
    expect(store.commits).toEqual([]);
  });

  test("stops at the daily match budget and counts the refusal", async () => {
    store.matches.set("NA1_9", { crawledAt: NOW, depth: 0 });
    const riot = fakeRiot({});
    seedPlayer("p1");
    const result = await runCrawlTick(
      deps(riot, { dailyMatchBudget: () => 1 }),
    );
    expect(result.status).toBe("budget-exhausted");
    expect(riot.calls).toEqual([]);
    const metric = await crawlBudgetRefusalsTotal.get();
    expect(
      metric.values.some((value) =>
        Object.values(value.labels).includes("daily-match-budget"),
      ),
    ).toBe(true);
  });

  test("visits a player, stores unseen crawlable matches and deepens participants", async () => {
    seedPlayer("p1", 0);
    const riot = fakeRiot({
      league: [
        {
          queueType: "RANKED_SOLO_5x5",
          tier: "GOLD",
          rank: "II",
          leaguePoints: 10,
          wins: 1,
          losses: 1,
        },
      ],
      ids: { "p1:420": ["NA1_100", "NA1_101"], "p1:450": ["NA1_102"] },
      matches: {
        NA1_100: rawMatch("NA1_100", { participants: ["p1", "pa"] }),
        NA1_101: rawMatch("NA1_101", {
          queueId: 450,
          mapId: 12,
          participants: ["p1", "pb"],
        }),
      },
    });
    const result = await runCrawlTick(deps(riot));
    // p1's batch admits its participants, so a second batch in the same tick
    // visits them (pa has no matches of its own here).
    expect(result).toMatchObject({
      status: "completed",
      playersVisited: 2,
      matchesStored: 1,
      segmentsWritten: 1,
    });
    expect(store.commits[0]?.visits.map((visit) => unP(visit.puuid))).toEqual([
      "p1",
    ]);
    expect(store.matches.has("NA1_100")).toBe(true);
    expect(store.matches.has("NA1_101")).toBe(false);
    const frontier = [...store.frontier.values()];
    expect(frontier.find((row) => row.puuid === P("pa"))?.depth).toBe(1);
    expect(store.frontier.get(P("p1"))?.nextEligibleAt).toEqual(
      crawlCooldownEnd(NOW),
    );
    const [segment] = store2objects.put;
    expect(segment?.objectKey).toMatch(
      /^crawl\/v1\/route=na1\/dt=2026-11-14\/seg-[0-9a-f]{64}\.ndjson\.zst$/u,
    );
    const [line] = decodeSegment(segment?.bytes ?? new Uint8Array());
    expect(line).toMatchObject({
      matchId: "NA1_100",
      visited: { puuid: P("p1"), tier: "GOLD", division: "II" },
    });
    // The lake inbox gets the same segment, and only once it is committed.
    expect(inboxed.map((entry) => entry.segment.sha256)).toEqual([
      segment?.sha256,
    ]);
    expect(inboxed.every((entry) => entry.committed)).toBe(true);
  });

  test("a failed lake-inbox write does not undo or fail a committed tick", async () => {
    seedPlayer("p1", 0);
    const riot = fakeRiot({
      ids: { "p1:420": ["NA1_100"] },
      matches: { NA1_100: rawMatch("NA1_100", { participants: ["p1"] }) },
    });
    const result = await runCrawlTick(
      deps(riot, {
        lakeInbox: () => Promise.reject(new Error("lake volume full")),
      }),
    );
    expect(result).toMatchObject({ status: "completed", segmentsWritten: 1 });
    expect(store.matches.has("NA1_100")).toBe(true);
  });

  test("looks the rank bracket up once per visited player", async () => {
    seedPlayer("p1");
    seedPlayer("p2");
    const riot = fakeRiot({});
    await runCrawlTick(deps(riot));
    expect(riot.calls.filter((call) => call.startsWith("league:"))).toEqual([
      "league:p1",
      "league:p2",
    ]);
  });

  test("never goes deeper than depth 2", async () => {
    seedPlayer("p1", 2);
    const riot = fakeRiot({
      ids: { "p1:420": ["NA1_100"] },
      matches: {
        NA1_100: rawMatch("NA1_100", { participants: ["p1", "deep"] }),
      },
    });
    await runCrawlTick(deps(riot));
    expect(store.matches.has("NA1_100")).toBe(true);
    expect(store.frontier.has(P("deep"))).toBe(false);
  });

  test("skips a match that includes an erased player", async () => {
    seedPlayer("p1");
    store.erased.add(puuidHash(P("gone")));
    const riot = fakeRiot({
      ids: { "p1:420": ["NA1_100"] },
      matches: {
        NA1_100: rawMatch("NA1_100", { participants: ["p1", "gone"] }),
      },
    });
    const result = await runCrawlTick(deps(riot));
    expect(result.matchesStored).toBe(0);
    expect(store.frontier.has(P("gone"))).toBe(false);
  });

  test("does not visit an erased player or one in cooldown", async () => {
    seedPlayer("erased");
    store.erased.add(puuidHash(P("erased")));
    store.frontier.set(P("cooling"), {
      puuid: P("cooling"),
      platformRoute: "NA1",
      depth: 0,
      seedMatchId: M("NA1_1"),
      nextEligibleAt: new Date(NOW.getTime() + 1000),
    });
    const riot = fakeRiot({});
    const result = await runCrawlTick(deps(riot));
    expect(result.playersVisited).toBe(0);
    expect(riot.calls).toEqual([]);
  });

  test("a 429 ends the tick without marking the player visited", async () => {
    seedPlayer("p1");
    const riot = fakeRiot({
      ids: { "p1:420": ["NA1_100"] },
      failMatchWith: new RiotHttpError({
        status: 429,
        statusText: "Too Many Requests",
        body: {},
        url: "https://x",
        headers: new Headers({ "x-rate-limit-type": "application" }),
      }),
    });
    const result = await runCrawlTick(deps(riot));
    expect(result.status).toBe("rate-limited");
    expect(result.playersVisited).toBe(0);
    expect(store.frontier.get(P("p1"))?.lastVisitedAt).toBeUndefined();
  });

  test("a malformed Riot match fails loudly", async () => {
    seedPlayer("p1");
    const riot = fakeRiot({
      ids: { "p1:420": ["NA1_100"] },
      matches: { NA1_100: { info: {} } },
    });
    await expect(runCrawlTick(deps(riot))).rejects.toThrow();
  });

  test("seeds depth-0 players from tracked-match participants and advances the cursor", async () => {
    const observedAt = new Date(NOW.getTime() - 60_000);
    store.observations = [
      {
        riotMatchId: M("NA1_7"),
        matchObjectKey: "games/x/match.json",
        observedAt,
      },
    ];
    store2objects.texts.set(
      "games/x/match.json",
      JSON.stringify(rawMatch("NA1_7", { participants: ["t1", "t2"] })),
    );
    const result = await runCrawlTick(deps(fakeRiot({})));
    expect(result.seededObservations).toBe(1);
    expect(store.frontier.get(P("t1"))?.depth).toBe(0);
    expect(store.cursor).toEqual({ observedAt, matchId: "NA1_7" });
  });
});

describe("bracketFromLeagueEntries", () => {
  test("prefers solo/duo, then flex, then none", () => {
    const solo = { queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II" };
    const flex = { queueType: "RANKED_FLEX_SR", tier: "SILVER", rank: "I" };
    expect(bracketFromLeagueEntries([flex, solo])).toEqual({
      tier: "GOLD",
      division: "II",
    });
    expect(bracketFromLeagueEntries([flex])).toEqual({
      tier: "SILVER",
      division: "I",
    });
    expect(bracketFromLeagueEntries([])).toBeNull();
    expect(bracketFromLeagueEntries([{ queueType: "CHERRY" }])).toBeNull();
  });
});

describe("the erasure fence", () => {
  test("discards the tick when an erasure lands before its commit", async () => {
    seedPlayer("p1");
    const riot = fakeRiot({
      ids: { "p1:420": ["NA1_100"] },
      matches: {
        NA1_100: rawMatch("NA1_100", { participants: ["p1", "late"] }),
      },
    });
    store.beforeCommit = () => {
      store.erased.add(puuidHash(P("late")));
    };
    await expect(runCrawlTick(deps(riot))).rejects.toBeInstanceOf(
      CrawlErasureFenceError,
    );
    expect(store.commits).toEqual([]);
    expect(store.matches.has("NA1_100")).toBe(false);
    // The segment reached S3 before the commit refused, so it is queued for deletion.
    expect(store.deletions).toEqual(
      store2objects.put.map((segment) => segment.objectKey),
    );
    expect(store.deletions).toHaveLength(1);
    expect(inboxed).toEqual([]);
  });
});

/**
 * A fake budget in front of the fake Riot, on its own virtual clock: it admits
 * `admits` calls, then refuses each with `waitMs` until a sleep refills it by
 * `refill`. It also counts match calls in flight at once.
 */
class FakeBudget {
  now = NOW.getTime();
  readonly sleeps: number[] = [];
  refusals = 0;
  private matchesInFlight = 0;
  maxMatchesInFlight = 0;

  constructor(
    private admits: number,
    private readonly window: { waitMs: number; refill: number },
  ) {}

  private take(): void {
    if (this.admits <= 0) {
      this.refusals += 1;
      throw new RiotBudgetRefusedError("https://americas.api.riotgames.com", {
        reason: "app-window",
        waitMs: this.window.waitMs,
      });
    }
    this.admits -= 1;
  }

  wrap(riot: CrawlRiotApi): CrawlRiotApi {
    return {
      matchIds: async (...args) => {
        this.take();
        return riot.matchIds(...args);
      },
      match: async (...args) => {
        this.take();
        this.matchesInFlight += 1;
        this.maxMatchesInFlight = Math.max(
          this.maxMatchesInFlight,
          this.matchesInFlight,
        );
        try {
          await Promise.resolve();
          return await riot.match(...args);
        } finally {
          this.matchesInFlight -= 1;
        }
      },
      timeline: async (...args) => {
        this.take();
        return riot.timeline(...args);
      },
      leagueEntries: async (...args) => {
        this.take();
        return riot.leagueEntries(...args);
      },
    };
  }

  deps(riot: CrawlRiotApi, overrides: Partial<CrawlDeps> = {}): CrawlDeps {
    return deps(this.wrap(riot), {
      now: () => new Date(this.now),
      sleep: (milliseconds) => {
        this.sleeps.push(milliseconds);
        this.now += milliseconds;
        this.admits += this.window.refill;
        return Promise.resolve();
      },
      ...overrides,
    });
  }
}

/** Seeds `players` players, each with `perPlayer` unique crawlable ranked matches. */
function crowd(players: number, perPlayer: number): RiotScript {
  const ids: Record<string, string[]> = {};
  const matches: Record<string, unknown> = {};
  for (let player = 0; player < players; player += 1) {
    const name = `c${player.toString()}`;
    seedPlayer(name);
    const own = Array.from(
      { length: perPlayer },
      (_, index) => `NA1_${(1000 * (player + 1) + index).toString()}`,
    );
    ids[`${name}:420`] = own.slice(0, 20);
    ids[`${name}:440`] = own.slice(20);
    for (const id of own) {
      matches[id] = rawMatch(id, { participants: [name] });
    }
  }
  return { ids, matches };
}

describe("runCrawlTick under the Riot budget", () => {
  test("does as much work as the budget admits, then stops cleanly when it refuses", async () => {
    const budget = new FakeBudget(20, { waitMs: 60_000, refill: 0 });
    const result = await runCrawlTick(budget.deps(fakeRiot(crowd(3, 10))));

    expect(result.status).toBe("completed");
    expect(budget.refusals).toBeGreaterThan(0);
    // A refusal longer than a tick may wait is never slept through.
    expect(budget.sleeps).toEqual([]);
    expect(result.matchesStored).toBeGreaterThan(0);
    expect(result.matchesStored).toBeLessThan(30);
    // Everything fetched is committed; the player cut short is not marked visited.
    expect(store.matches.size).toBe(result.matchesStored);
    expect(result.playersVisited).toBeLessThan(3);
    const unvisited = [...store.frontier.values()].filter(
      (row) => row.lastVisitedAt === undefined,
    );
    expect(unvisited.length).toBe(3 - result.playersVisited);
  });

  test("waits out a short refusal and carries on", async () => {
    const budget = new FakeBudget(5, { waitMs: 5000, refill: 1000 });
    const result = await runCrawlTick(budget.deps(fakeRiot(crowd(3, 10))));

    // Each refused in-flight call waits on its own; every wait is the ledger's.
    expect(budget.sleeps.length).toBeGreaterThan(0);
    expect(new Set(budget.sleeps)).toEqual(new Set([5000]));
    expect(result).toMatchObject({
      status: "completed",
      playersVisited: 3,
      matchesStored: 30,
    });
  });

  test("never waits past the tick's deadline", async () => {
    const budget = new FakeBudget(0, { waitMs: 10_000, refill: 1 });
    const result = await runCrawlTick(budget.deps(fakeRiot(crowd(3, 10))));

    expect(result.status).toBe("completed");
    expect(budget.sleeps.length).toBeGreaterThan(0);
    const deadline = NOW.getTime() + CRAWL_TICK_DEADLINE_MS;
    expect(budget.now).toBeLessThan(deadline);
    expect(budget.now + 10_000).toBeGreaterThanOrEqual(deadline);
  });

  test("fetches a player's unseen matches eight at a time", async () => {
    const budget = new FakeBudget(Infinity, { waitMs: 1, refill: 0 });
    const result = await runCrawlTick(budget.deps(fakeRiot(crowd(1, 30))));

    expect(result.matchesStored).toBe(30);
    expect(budget.maxMatchesInFlight).toBe(8);
  });

  test("commits in batches of about a hundred matches", async () => {
    const budget = new FakeBudget(Infinity, { waitMs: 1, refill: 0 });
    const result = await runCrawlTick(budget.deps(fakeRiot(crowd(5, 30))));

    expect(result).toMatchObject({ playersVisited: 5, matchesStored: 150 });
    expect(store.commits.length).toBe(2);
    for (const commit of store.commits) {
      const matches = commit.segments.flatMap((segment) => segment.matches);
      expect(matches.length).toBeLessThanOrEqual(CRAWL_MATCHES_PER_COMMIT + 60);
    }
    expect(store.matches.size).toBe(150);
  });

  test("stores at most its paced share of the day's budget", async () => {
    // Noon leaves 720 one-minute ticks; 2160 remaining is 3 matches a tick.
    const budget = new FakeBudget(Infinity, { waitMs: 1, refill: 0 });
    const result = await runCrawlTick(
      budget.deps(fakeRiot(crowd(1, 10)), { dailyMatchBudget: () => 2160 }),
    );

    expect(result.matchesStored).toBe(3);
    // The visit was cut short by the allowance, so its cooldown does not start.
    expect(result.playersVisited).toBe(0);
  });
});
