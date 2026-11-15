import { beforeEach, describe, expect, test } from "vitest";
import {
  LeaguePuuidSchema,
  RiotMatchIdSchema,
  type LeaguePuuid,
  type RiotMatchId,
} from "@scout-for-lol/data";
import { RiotHttpError } from "#src/league/api/client/errors.ts";
import { crawlBudgetRefusalsTotal } from "#src/metrics/crawl.ts";
import {
  CRAWL_MAX_DEPTH,
  crawlCooldownEnd,
  puuidHash,
} from "./crawl-config.ts";
import type { CrawlRiotApi } from "./crawl-riot-client.ts";
import {
  bracketFromLeagueEntries,
  runCrawlTick,
  type CrawlDeps,
} from "./crawl-run.ts";
import { decodeSegment, type EncodedSegment } from "./crawl-segment.ts";
import type {
  CommitInput,
  CrawlObjectStore,
  CrawlStore,
  FrontierPlayer,
  NewFrontierPlayer,
  SeedCursor,
  TrackedObservation,
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
  async commit(input: CommitInput) {
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
        info: { participants: [], frames: [{ events: [] }] },
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

function deps(
  riot: CrawlRiotApi,
  overrides: Partial<CrawlDeps> = {},
): CrawlDeps {
  return {
    store,
    riot,
    objects: store2objects,
    now: () => NOW,
    enabled: () => true,
    dailyMatchBudget: () => 1000,
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
    expect(result).toMatchObject({
      status: "completed",
      playersVisited: 1,
      matchesStored: 1,
      segmentsWritten: 1,
    });
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
