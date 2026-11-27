import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/data";
import { ERASURE_REDACTION_NOTICE } from "#src/explore/inspection/erasure-redaction.ts";
import { runRawErasureSweep } from "#src/report-lake/crawl/crawl-raw-erasure.ts";
import { createPrismaRawErasureStore } from "#src/report-lake/crawl/crawl-raw-erasure-store.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  crawlSegmentOf,
  distinctCrawlPuuid,
} from "#src/testing/report-lake/crawl-segments.ts";
import { puuidHash } from "./crawl-config.ts";
import {
  applyCrawlErasure,
  crawlErasureComplete,
  planCrawlErasure,
} from "./crawl-erasure.ts";
import { pruneCrawlFrontierBatch } from "./crawl-frontier-prune.ts";
import { createPrismaCrawlStore } from "./crawl-prisma-store.ts";
import { CrawlErasureFenceError } from "./crawl-store.ts";

// DATABASE-BACKED: needs the per-suite PostgreSQL the `integration` step
// provides. Not run when this PR was authored (no database turn).
const { prisma } = createTestDatabase("participant-crawl-erasure");

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = new Date("2026-11-14T12:00:00Z");
const DAY = "2026-11-14";
const ERASED = LeaguePuuidSchema.parse(distinctCrawlPuuid("erased"));
const RIOT_ID = "Erased Player#EUW";
const OWNER = DiscordAccountIdSchema.parse("700000000000000001");

beforeEach(async () => {
  await prisma.crawlMatch.deleteMany();
  await prisma.crawlSegment.deleteMany();
  await prisma.crawlFrontier.deleteMany();
  await prisma.crawlObjectDeletion.deleteMany();
  await prisma.erasedPuuid.deleteMany();
  await prisma.scoutInteractiveRun.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.user.deleteMany();
});

async function conversationNaming(text: string, shared: boolean) {
  await prisma.user.upsert({
    where: { discordId: OWNER },
    update: {},
    create: { discordId: OWNER, discordUsername: "asker" },
  });
  const conversation = await prisma.exploreConversation.create({
    data: {
      userId: OWNER,
      title: "Who is good?",
      ...(shared ? { shareToken: crypto.randomUUID(), sharedAt: NOW } : {}),
    },
  });
  const question = await prisma.exploreMessage.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: `How does ${RIOT_ID} play?`,
    },
  });
  const answer = await prisma.exploreMessage.create({
    data: {
      conversationId: conversation.id,
      parentId: question.id,
      role: "assistant",
      content: text,
      preview: JSON.stringify({ rows: [{ player: text }] }),
    },
  });
  const payload = await prisma.exploreToolPayload.create({
    data: {
      conversationId: conversation.id,
      runId: "run-1",
      toolCallId: crypto.randomUUID(),
      toolName: "run_report_query",
      direction: "output",
      payload: JSON.stringify({ rows: [{ puuid: text }] }),
    },
  });
  return { conversation, question, answer, payload };
}

describe("applyCrawlErasure", () => {
  test("records the hash, deletes the frontier row and redacts Explore copies, once", async () => {
    await prisma.crawlFrontier.create({
      data: {
        puuid: ERASED,
        platformRoute: "NA1",
        depth: 1,
        nextEligibleAt: NOW,
      },
    });
    const byPuuid = await conversationNaming(ERASED, true);
    const byRiotId = await conversationNaming(`${RIOT_ID} won`, false);
    const unrelated = await conversationNaming("Someone Else#NA1", false);
    const target = { puuid: ERASED, riotId: RIOT_ID };

    const plan = await planCrawlErasure(prisma, target);
    expect(plan).toMatchObject({
      puuidHash: puuidHash(ERASED),
      progress: null,
      frontierRow: true,
      // One payload names the PUUID, the other the Riot ID.
      copies: { toolPayloads: 2, messages: 2, sharedConversations: 1 },
    });

    const result = await applyCrawlErasure(prisma, target);
    expect(result).toMatchObject({
      newlyRecorded: true,
      frontierRowsDeleted: 1,
      copies: { toolPayloads: 2, messages: 2 },
    });
    expect(
      await prisma.crawlFrontier.findUnique({ where: { puuid: ERASED } }),
    ).toBeNull();
    for (const copy of [byPuuid, byRiotId]) {
      const answer = await prisma.exploreMessage.findUniqueOrThrow({
        where: { id: copy.answer.id },
      });
      expect(answer).toMatchObject({
        content: ERASURE_REDACTION_NOTICE,
        preview: null,
      });
    }
    const payload = await prisma.exploreToolPayload.findUniqueOrThrow({
      where: { id: byPuuid.payload.id },
    });
    expect(payload.payload).toBe(
      JSON.stringify({ redacted: ERASURE_REDACTION_NOTICE }),
    );
    // The asker's own question and an unrelated answer are left alone.
    const question = await prisma.exploreMessage.findUniqueOrThrow({
      where: { id: byPuuid.question.id },
    });
    expect(question.content).toContain(RIOT_ID);
    const untouched = await prisma.exploreMessage.findUniqueOrThrow({
      where: { id: unrelated.answer.id },
    });
    expect(untouched.content).toBe("Someone Else#NA1");

    const again = await applyCrawlErasure(prisma, target);
    expect(again).toMatchObject({
      newlyRecorded: false,
      frontierRowsDeleted: 0,
      copies: { toolPayloads: 0, messages: 0, runs: 0 },
    });
    const { progress } = await planCrawlErasure(prisma, target);
    expect(progress).toMatchObject({
      copiesRedacted: 4,
      rawSweptAt: null,
      lakeErasedAt: null,
    });
    expect(crawlErasureComplete(progress)).toBe(false);
  });
});

/** Long after the cooldown and the lookback: the pruner drops every row. */
async function pruneEverything() {
  const later = new Date(NOW.getTime() + 60 * 86_400_000);
  await pruneCrawlFrontierBatch(prisma, {
    now: later,
    batchSize: 1000,
    backlogCap: 1_000_000,
  });
  expect(await prisma.crawlFrontier.count()).toBe(0);
}

describe("erasure after the frontier was pruned", () => {
  const MATCH = RiotMatchIdSchema.parse("NA1_9700000021");
  const KEPT = RiotMatchIdSchema.parse("NA1_9700000022");
  const OTHER = LeaguePuuidSchema.parse(distinctCrawlPuuid("other"));

  function newcomer(depth: number) {
    return {
      puuid: ERASED,
      platformRoute: "NA1",
      depth,
      seedMatchId: KEPT,
    };
  }

  /** The player visited and crawled, as one committed tick leaves them. */
  async function crawledPlayer() {
    const store = createPrismaCrawlStore(prisma);
    await store.admit([newcomer(1)], NOW);
    const segment = await crawlSegmentOf(DAY, [
      { matchId: MATCH, player: ERASED },
      { matchId: KEPT },
    ]);
    await store.commit({
      now: NOW,
      erasureMark: await store.erasureMark(),
      segments: [
        {
          segment,
          matches: [MATCH, KEPT].map((riotMatchId) => ({
            riotMatchId,
            platformRoute: "NA1",
            queueId: 420,
            gameCreatedAt: NOW,
            depth: 1,
            visitedPuuid: riotMatchId === MATCH ? ERASED : OTHER,
            timelineSampled: false,
          })),
        },
      ],
      visits: [{ puuid: ERASED, rank: null }],
      children: [],
    });
    return { store, segment };
  }

  test("still finds the player's matches, erases them and refuses them back", async () => {
    const { store, segment } = await crawledPlayer();
    await pruneEverything();

    const target = { puuid: ERASED };
    expect(await planCrawlErasure(prisma, target)).toMatchObject({
      frontierRow: false,
      matchesVisited: 1,
    });
    expect(await applyCrawlErasure(prisma, target)).toMatchObject({
      newlyRecorded: true,
      frontierRowsDeleted: 0,
    });

    // The raw sweep finds the player by what the segment holds, not by a row.
    const objects = new Map([[segment.objectKey, segment.bytes]]);
    const summary = await runRawErasureSweep({
      store: createPrismaRawErasureStore(prisma),
      objects: {
        read: (key) => Promise.resolve(objects.get(key) ?? new Uint8Array()),
        put: (replacement) => {
          objects.set(replacement.objectKey, replacement.bytes);
          return Promise.resolve();
        },
        delete: (key) => {
          objects.delete(key);
          return Promise.resolve();
        },
      },
      segmentBudget: 100,
    });
    expect(summary).toMatchObject({
      segmentsRewritten: 1,
      matchesRemoved: 1,
      swept: [puuidHash(ERASED)],
    });
    const remainingMatches = await prisma.crawlMatch.findMany();
    expect(remainingMatches.map((row) => row.riotMatchId)).toEqual([KEPT]);
    for (const bytes of objects.values()) {
      expect(
        new TextDecoder().decode(Bun.zstdDecompressSync(bytes)),
      ).not.toContain(ERASED);
    }

    // A later crawled match naming the pruned, erased player cannot re-admit them.
    expect(await store.admit([newcomer(1)], NOW)).toEqual({
      admitted: 0,
      erased: 1,
    });
    expect(await prisma.crawlFrontier.count()).toBe(0);
  });

  test("deletes the row of a player the pruner dropped and a later match re-admitted", async () => {
    const { store } = await crawledPlayer();
    await pruneEverything();
    expect(await store.admit([newcomer(2)], NOW)).toEqual({
      admitted: 1,
      erased: 0,
    });

    const result = await applyCrawlErasure(prisma, { puuid: ERASED });

    expect(result).toMatchObject({
      newlyRecorded: true,
      frontierRowsDeleted: 1,
    });
    expect(await prisma.crawlFrontier.count()).toBe(0);
  });
});

describe("the crawl commit fence", () => {
  test("refuses a commit when an erasure landed after the tick started", async () => {
    const store = createPrismaCrawlStore(prisma);
    const mark = await store.erasureMark();
    await prisma.erasedPuuid.create({ data: { puuidHash: puuidHash(ERASED) } });
    const segment = await crawlSegmentOf(DAY, [{ matchId: "NA1_9700000001" }]);
    await expect(
      store.commit({
        now: NOW,
        erasureMark: mark,
        segments: [{ segment, matches: [] }],
        visits: [],
        children: [],
      }),
    ).rejects.toBeInstanceOf(CrawlErasureFenceError);
    expect(await prisma.crawlSegment.count()).toBe(0);
  });
});

describe("the raw erasure store", () => {
  test("swaps a segment row, repoints kept matches and queues the old object", async () => {
    const original = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9700000011" },
      { matchId: "NA1_9700000012", player: ERASED },
    ]);
    const createdAt = new Date("2026-11-14T10:00:00Z");
    await prisma.crawlSegment.create({
      data: {
        sha256: original.sha256,
        objectKey: original.objectKey,
        route: original.route,
        dt: original.dt,
        matchCount: 2,
        bytes: original.bytes.length,
        createdAt,
      },
    });
    for (const id of ["NA1_9700000011", "NA1_9700000012"]) {
      await prisma.crawlMatch.create({
        data: {
          riotMatchId: RiotMatchIdSchema.parse(id),
          platformRoute: "NA1",
          queueId: 420,
          gameCreatedAt: NOW,
          depth: 1,
          visitedPuuid: id === "NA1_9700000012" ? ERASED : "v".repeat(78),
          timelineSampled: false,
          segmentSha256: original.sha256,
        },
      });
    }
    const replacement = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9700000011" },
    ]);
    const store = createPrismaRawErasureStore(prisma);
    const [old] = await store.segmentsAfter(null, 10);
    if (old === undefined) throw new Error("no segment");

    await store.replaceSegment({
      old,
      replacement,
      removedMatchIds: [RiotMatchIdSchema.parse("NA1_9700000012")],
    });

    expect(await prisma.crawlSegment.findMany()).toEqual([
      expect.objectContaining({ sha256: replacement.sha256, createdAt }),
    ]);
    expect(await prisma.crawlMatch.findMany()).toEqual([
      expect.objectContaining({
        riotMatchId: "NA1_9700000011",
        segmentSha256: replacement.sha256,
      }),
    ]);
    expect(await store.queuedDeletions(10)).toEqual([original.objectKey]);
    await store.forgetDeletion(original.objectKey);
    expect(await store.queuedDeletions(10)).toEqual([]);
  });

  test("saves a sweep cursor and refuses half of one", async () => {
    const hash = puuidHash(ERASED);
    await prisma.erasedPuuid.create({ data: { puuidHash: hash } });
    const store = createPrismaRawErasureStore(prisma);
    const cursor = { createdAt: NOW, sha256: "a".repeat(64) };
    await store.saveProgress([
      {
        puuidHash: hash,
        cursor,
        swept: true,
        segmentsRewritten: 2,
        matchesRemoved: 3,
      },
    ]);
    expect(await store.pending()).toEqual([]);
    expect(
      await prisma.erasedPuuid.findUniqueOrThrow({
        where: { puuidHash: hash },
      }),
    ).toMatchObject({
      rawCursorCreatedAt: NOW,
      rawCursorSha256: cursor.sha256,
      segmentsRewritten: 2,
      matchesRemoved: 3,
    });
    await expect(
      prisma.erasedPuuid.update({
        where: { puuidHash: hash },
        data: { rawCursorSha256: null },
      }),
    ).rejects.toThrow("ErasedPuuid_raw_cursor_check");
    await expect(
      prisma.crawlObjectDeletion.create({
        data: { objectKey: "games/NA1_1/match.json" },
      }),
    ).rejects.toThrow("CrawlObjectDeletion_prefix_check");
  });
});
