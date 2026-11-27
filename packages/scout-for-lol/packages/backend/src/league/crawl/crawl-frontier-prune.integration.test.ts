import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { crawlCooldownEnd } from "./crawl-config.ts";
import { pruneCrawlFrontierBatch } from "./crawl-frontier-prune.ts";
import { createPrismaCrawlStore } from "./crawl-prisma-store.ts";

// DATABASE-BACKED: needs the per-suite PostgreSQL the `integration` step
// provides.
const { prisma } = createTestDatabase("participant-crawl-frontier-prune");

afterAll(async () => {
  await prisma.$disconnect();
});

const DAY_MS = 86_400_000;
const NOW = new Date("2026-12-01T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const puuid = (name: string) =>
  LeaguePuuidSchema.parse(name.padEnd(78, "0").slice(0, 78));
const BIG = { batchSize: 1000, backlogCap: 1_000_000 };

beforeEach(async () => {
  await prisma.crawlFrontier.deleteMany();
});

/** An unvisited row that became eligible `eligibleDaysAgo` days ago. */
function queued(name: string, depth: number, eligibleDaysAgo: number) {
  return {
    puuid: puuid(name),
    platformRoute: "NA1",
    depth,
    nextEligibleAt: ago(eligibleDaysAgo),
  };
}

/** A row visited `visitedDaysAgo` days ago, so eligible again 7 days after. */
function visited(name: string, depth: number, visitedDaysAgo: number) {
  const lastVisitedAt = ago(visitedDaysAgo);
  return {
    puuid: puuid(name),
    platformRoute: "NA1",
    depth,
    lastVisitedAt,
    nextEligibleAt: crawlCooldownEnd(lastVisitedAt),
  };
}

async function remaining(): Promise<string[]> {
  const rows = await prisma.crawlFrontier.findMany({
    select: { puuid: true },
    orderBy: { puuid: "asc" },
  });
  return rows.map((row) => row.puuid.slice(0, 3));
}

describe("the stale rule", () => {
  test("drops rows unclaimed for the whole lookback, visited or not, and keeps the rest", async () => {
    await prisma.crawlFrontier.createMany({
      data: [
        queued("a-old-unvisited", 1, 40),
        visited("b-old-visited", 0, 50),
        queued("c-recent-unvisited", 1, 10),
        visited("d-in-cooldown", 0, 1),
        queued("e-old-depth2", 2, 29),
      ],
    });

    const result = await pruneCrawlFrontierBatch(prisma, { now: NOW, ...BIG });

    expect(result).toEqual({ stale: 3, overflow: 0, more: false });
    expect(await remaining()).toEqual(["c-r", "d-i"]);
  });
});

describe("the backlog rule", () => {
  test("keeps each depth's newest unvisited rows and never counts or drops a visited one", async () => {
    await prisma.crawlFrontier.createMany({
      data: [
        ...[1, 2, 3, 4, 5].map((age) =>
          queued(`d1-age${age.toString()}`, 1, age),
        ),
        ...[1, 2, 3].map((age) => queued(`d2-age${age.toString()}`, 2, age)),
        visited("v1-visited", 1, 20),
        visited("v2-visited", 1, 2),
      ],
    });

    const result = await pruneCrawlFrontierBatch(prisma, {
      now: NOW,
      batchSize: 1000,
      backlogCap: 2,
    });

    expect(result).toEqual({ stale: 0, overflow: 4, more: false });
    expect(await remaining()).toEqual([
      "d1-",
      "d1-",
      "d2-",
      "d2-",
      "v1-",
      "v2-",
    ]);
    const kept = await prisma.crawlFrontier.findMany({
      where: { lastVisitedAt: null },
      orderBy: [{ depth: "asc" }, { nextEligibleAt: "desc" }],
      select: { puuid: true },
    });
    expect(kept.map((row) => row.puuid.slice(0, 8))).toEqual([
      "d1-age1".padEnd(8, "0"),
      "d1-age2".padEnd(8, "0"),
      "d2-age1".padEnd(8, "0"),
      "d2-age2".padEnd(8, "0"),
    ]);
  });

  test("keeps everything while a depth is within its cap", async () => {
    await prisma.crawlFrontier.createMany({
      data: [queued("a", 1, 1), queued("b", 1, 2), queued("c", 2, 3)],
    });
    const result = await pruneCrawlFrontierBatch(prisma, {
      now: NOW,
      batchSize: 1000,
      backlogCap: 2,
    });
    expect(result).toEqual({ stale: 0, overflow: 0, more: false });
    expect(await prisma.crawlFrontier.count()).toBe(3);
  });
});

describe("batching", () => {
  test("deletes at most one batch and says when more may wait", async () => {
    await prisma.crawlFrontier.createMany({
      data: Array.from({ length: 10 }, (_, index) =>
        queued(`s${index.toString().padStart(2, "0")}`, 1, 40 + index),
      ),
    });
    const batch = { now: NOW, batchSize: 4, backlogCap: 1_000_000 };

    expect(await pruneCrawlFrontierBatch(prisma, batch)).toEqual({
      stale: 4,
      overflow: 0,
      more: true,
    });
    expect(await prisma.crawlFrontier.count()).toBe(6);
    expect(await pruneCrawlFrontierBatch(prisma, batch)).toMatchObject({
      stale: 4,
      more: true,
    });
    expect(await pruneCrawlFrontierBatch(prisma, batch)).toEqual({
      stale: 2,
      overflow: 0,
      more: false,
    });
    expect(await prisma.crawlFrontier.count()).toBe(0);
  });

  test("spends the batch on stale rows before backlog overflow", async () => {
    await prisma.crawlFrontier.createMany({
      data: [
        queued("stale1", 1, 40),
        queued("stale2", 1, 41),
        queued("fresh1", 1, 1),
        queued("fresh2", 1, 2),
        queued("fresh3", 1, 3),
      ],
    });
    const result = await pruneCrawlFrontierBatch(prisma, {
      now: NOW,
      batchSize: 3,
      backlogCap: 1,
    });
    expect(result).toEqual({ stale: 2, overflow: 1, more: true });
    expect(await prisma.crawlFrontier.count()).toBe(2);
  });
});

describe("running beside the crawl", () => {
  test("skips a row a crawl commit holds instead of waiting on it", async () => {
    await prisma.crawlFrontier.createMany({
      data: [
        queued("held", 1, 40),
        queued("free1", 1, 41),
        queued("free2", 1, 42),
      ],
    });
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "puuid" FROM "CrawlFrontier" WHERE "puuid" = ${puuid("held")} FOR UPDATE`;
      // A second connection: it would block until this transaction ends if the
      // pruner waited on the held row, and the test would time out.
      return await pruneCrawlFrontierBatch(prisma, { now: NOW, ...BIG });
    });
    expect(result).toEqual({ stale: 2, overflow: 0, more: false });
    expect(await remaining()).toEqual(["hel"]);
  });

  test("a commit for a player the pruner already dropped neither fails nor leaves a row", async () => {
    const store = createPrismaCrawlStore(prisma);
    await prisma.crawlFrontier.create({ data: queued("gone", 1, 40) });
    await pruneCrawlFrontierBatch(prisma, { now: NOW, ...BIG });

    await store.commit({
      now: NOW,
      erasureMark: await store.erasureMark(),
      segments: [],
      visits: [{ puuid: puuid("gone"), rank: null }],
      children: [
        {
          puuid: puuid("child"),
          platformRoute: "NA1",
          depth: 2,
          seedMatchId: RiotMatchIdSchema.parse("NA1_1"),
        },
      ],
    });

    expect(await remaining()).toEqual(["chi"]);
  });
});

async function indexesOf(table: string): Promise<string[]> {
  const rows = z
    .array(z.object({ indexname: z.string() }))
    .parse(
      await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename = ${table} ORDER BY indexname`,
    );
  return rows.map((row) => row.indexname);
}

describe("the schema", () => {
  test("serves the claim order and the pruner from a (depth, nextEligibleAt) index", async () => {
    expect(await indexesOf("CrawlFrontier")).toContain(
      "CrawlFrontier_depth_nextEligibleAt_idx",
    );
  });

  test("serves erasure's lookup of a player's matches from an index", async () => {
    expect(await indexesOf("CrawlMatch")).toContain(
      "CrawlMatch_visitedPuuid_idx",
    );
  });

  test("a row inserts and is visited without the retired columns", async () => {
    const store = createPrismaCrawlStore(prisma);
    await store.admit(
      [
        {
          puuid: puuid("retired"),
          platformRoute: "NA1",
          depth: 1,
          seedMatchId: RiotMatchIdSchema.parse("NA1_1"),
        },
      ],
      NOW,
    );
    await store.commit({
      now: NOW,
      erasureMark: await store.erasureMark(),
      segments: [],
      visits: [{ puuid: puuid("retired"), rank: null }],
      children: [],
    });
    expect(
      await prisma.crawlFrontier.findUniqueOrThrow({
        where: { puuid: puuid("retired") },
      }),
    ).toMatchObject({ seedMatchId: "", visitCount: 0, lastVisitedAt: NOW });
  });
});
