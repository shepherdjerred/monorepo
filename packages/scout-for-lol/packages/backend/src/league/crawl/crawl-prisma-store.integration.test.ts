import { afterAll, describe, expect, test } from "vitest";
import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { crawlCooldownEnd, puuidHash } from "./crawl-config.ts";
import { createPrismaCrawlStore } from "./crawl-prisma-store.ts";
import { encodeSegment } from "./crawl-segment.ts";

// DATABASE-BACKED: needs the per-suite PostgreSQL the `integration` step
// provides. Not run when this PR was authored (no database turn).
const { prisma } = createTestDatabase("participant-crawl-store");
const store = createPrismaCrawlStore(prisma);

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = new Date("2026-11-14T12:00:00Z");
const puuid = (letter: string) => LeaguePuuidSchema.parse(letter.repeat(78));
const matchId = (id: string) => RiotMatchIdSchema.parse(id);

function player(letter: string, depth = 0) {
  return {
    puuid: puuid(letter),
    platformRoute: "NA1",
    depth,
    seedMatchId: matchId("NA1_1"),
  };
}

/** A frontier row as the table stores it: the player without the match that surfaced them. */
function storedRow(letter: string, depth = 0) {
  const { seedMatchId: _surfacedBy, ...stored } = player(letter, depth);
  return stored;
}

async function expectRejected(promise: Promise<unknown>, constraint: string) {
  await expect(promise).rejects.toThrow(constraint);
}

describe("crawl schema constraints", () => {
  test("cap frontier depth at 2", async () => {
    await expectRejected(
      prisma.crawlFrontier.create({
        data: { ...storedRow("d", 3), nextEligibleAt: NOW },
      }),
      "CrawlFrontier_depth_check",
    );
  });

  test("hold a visited player to the 7-day cooldown", async () => {
    await expectRejected(
      prisma.crawlFrontier.create({
        data: {
          ...storedRow("c"),
          lastVisitedAt: NOW,
          nextEligibleAt: new Date(NOW.getTime() + 6 * 86_400_000),
        },
      }),
      "CrawlFrontier_cooldown_check",
    );
    await prisma.crawlFrontier.create({
      data: {
        ...storedRow("e"),
        lastVisitedAt: NOW,
        nextEligibleAt: crawlCooldownEnd(NOW),
      },
    });
  });

  test("allow exactly one control row", async () => {
    await expectRejected(
      prisma.crawlControl.create({
        data: { id: "other", seedCursorObservedAt: NOW },
      }),
      "CrawlControl_singleton_check",
    );
  });

  test("store erased players only as SHA-256 hex", async () => {
    await expectRejected(
      prisma.erasedPuuid.create({ data: { puuidHash: "not-a-hash" } }),
      "ErasedPuuid_hash_check",
    );
  });
});

describe("PostgreSQL crawl store", () => {
  test("admits new players once and refuses erased ones", async () => {
    await prisma.erasedPuuid.create({
      data: { puuidHash: puuidHash(puuid("x")) },
    });
    const first = await store.admit(
      [player("a"), player("x"), player("a", 1)],
      NOW,
    );
    expect(first).toEqual({ admitted: 1, erased: 1 });
    expect(await store.admit([player("a")], NOW)).toEqual({
      admitted: 0,
      erased: 0,
    });
    expect(await store.erasedAmong([puuid("a"), puuid("x")])).toEqual(
      new Set([puuid("x")]),
    );
  });

  test("claims eligible players shallowest first, skipping cooldown and erased", async () => {
    await store.admit([player("f", 2), player("g", 0)], NOW);
    const claimed = await store.claimEligible(new Date(NOW.getTime() + 1), 10);
    const order = claimed.map((row) => row.puuid);
    expect(order.indexOf(puuid("g"))).toBeLessThan(order.indexOf(puuid("f")));
    expect(order).not.toContain(puuid("x"));
  });

  test("commits a segment, its matches, the visit and deeper participants atomically", async () => {
    await store.admit([player("v")], NOW);
    const segment = encodeSegment({
      route: "na1",
      dt: "2026-11-14",
      records: [
        {
          v: 1,
          matchId: matchId("NA1_900"),
          platform: "NA1",
          crawledAt: NOW.toISOString(),
          depth: 0,
          visited: { puuid: puuid("v"), tier: "GOLD", division: "II" },
          match: {},
          timeline: null,
        },
      ],
    });
    await store.commit({
      now: NOW,
      erasureMark: await store.erasureMark(),
      segments: [
        {
          segment,
          matches: [
            {
              riotMatchId: matchId("NA1_900"),
              platformRoute: "NA1",
              queueId: 420,
              gameCreatedAt: NOW,
              depth: 0,
              visitedPuuid: puuid("v"),
              timelineSampled: false,
            },
          ],
        },
      ],
      visits: [{ puuid: puuid("v"), rank: { tier: "GOLD", division: "II" } }],
      children: [player("w", 1)],
    });

    expect(
      await store.unknownMatchIds([matchId("NA1_900"), matchId("NA1_901")]),
    ).toEqual(["NA1_901"]);
    expect(
      await store.matchesCrawledSince(new Date("2026-11-14T00:00:00Z")),
    ).toBe(1);
    const visited = await prisma.crawlFrontier.findUniqueOrThrow({
      where: { puuid: puuid("v") },
    });
    expect(visited.nextEligibleAt).toEqual(crawlCooldownEnd(NOW));
    expect(visited).toMatchObject({
      rankTier: "GOLD",
      rankDivision: "II",
      lastVisitedAt: NOW,
    });
    const child = await prisma.crawlFrontier.findUniqueOrThrow({
      where: { puuid: puuid("w") },
    });
    expect(child.depth).toBe(1);
    expect(
      await prisma.crawlSegment.findUniqueOrThrow({
        where: { sha256: segment.sha256 },
      }),
    ).toMatchObject({ objectKey: segment.objectKey, matchCount: 1 });
  });

  test("seeds from FULL tracked observations after the cursor", async () => {
    const cursor = await store.seedCursor(NOW);
    await prisma.matchObservation.create({
      data: {
        riotMatchId: matchId("NA1_800"),
        platformRoute: "NA1",
        processingPolicy: "FULL",
        deliveryMode: "live",
        gameCreatedAt: NOW,
        observedAt: new Date(NOW.getTime() + 1000),
        matchObjectKey: "games/2026/11/14/NA1_800/match.json",
        matchDigest: "a".repeat(64),
      },
    });
    const rows = await store.observationsAfter(
      cursor,
      new Date("2026-10-17T00:00:00Z"),
      10,
    );
    expect(rows.map((row) => row.riotMatchId)).toContain("NA1_800");
    await store.advanceSeedCursor({
      observedAt: new Date(NOW.getTime() + 1000),
      matchId: matchId("NA1_800"),
    });
    expect(
      await store.observationsAfter(
        {
          observedAt: new Date(NOW.getTime() + 1000),
          matchId: matchId("NA1_800"),
        },
        new Date("2026-10-17T00:00:00Z"),
        10,
      ),
    ).toEqual([]);
  });
});
