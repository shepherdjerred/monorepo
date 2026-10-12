import { beforeEach, describe, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type * as DurableReceiptsModule from "#src/report-lake/durable-receipts.ts";

/**
 * The consumer live view's read.
 *
 * A live game is a capture — a `raw-archive-prematch` receipt — still inside
 * its tracked lifetime, and its roster is the archived snapshot the receipt
 * attests to. The storage reads are stubbed: what is
 * under test is which receipts count, in what order, what is skipped before
 * any object is read, and that a broken archive contract is not papered over.
 */

const stubs = vi.hoisted(() => ({
  storedRawArchiveDescriptor: vi.fn(),
  readArchivedPrematchSnapshot: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("#src/report-lake/durable-receipts.ts", async () => {
  const actual = await vi.importActual<typeof DurableReceiptsModule>(
    "#src/report-lake/durable-receipts.ts",
  );
  return {
    ...actual,
    storedRawArchiveDescriptor: stubs.storedRawArchiveDescriptor,
  };
});
vi.mock("#src/report-lake/receipted-archive.ts", () => ({
  readArchivedPrematchSnapshot: stubs.readArchivedPrematchSnapshot,
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: { matchProcessingReceipt: { findMany: stubs.findMany } },
}));

const { listLivePrematchGames, livePrematchCapturesOf } =
  await import("#src/temporal/prematch/prematch-reads.ts");
const { LIVE_GAME_TTL_MS } =
  await import("#src/temporal/prematch/prematch-intents.ts");

const NOW = new Date("2026-09-20T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);
const LIVE = RiotMatchIdSchema.parse("NA1_9101");
const OLDER_LIVE = RiotMatchIdSchema.parse("NA1_9100");
const FINISHED = RiotMatchIdSchema.parse("NA1_9099");
const DESCRIPTOR = { kind: "prematch", key: "prematch/9101.json" };

function snapshot(gameId: number, puuids: (string | null)[]) {
  return {
    gameId,
    participants: puuids.map((puuid) => ({ puuid })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.storedRawArchiveDescriptor.mockResolvedValue(DESCRIPTOR);
});

describe("livePrematchCapturesOf", () => {
  test("keeps captures inside the tracked lifetime, newest first", () => {
    const captures = livePrematchCapturesOf(
      [
        { riotMatchId: OLDER_LIVE, recordedAt: minutesAgo(90) },
        { riotMatchId: LIVE, recordedAt: minutesAgo(5) },
        // Exactly at the horizon is over, as v1's `expiresAt > now` was.
        {
          riotMatchId: FINISHED,
          recordedAt: new Date(NOW.getTime() - LIVE_GAME_TTL_MS),
        },
      ],
      NOW,
    );

    expect(captures).toEqual([
      {
        riotMatchId: LIVE,
        detectedAt: minutesAgo(5),
        expiresAt: new Date(minutesAgo(5).getTime() + LIVE_GAME_TTL_MS),
      },
      {
        riotMatchId: OLDER_LIVE,
        detectedAt: minutesAgo(90),
        expiresAt: new Date(minutesAgo(90).getTime() + LIVE_GAME_TTL_MS),
      },
    ]);
  });

  test("counts one match once, from its earliest capture", () => {
    const captures = livePrematchCapturesOf(
      [
        { riotMatchId: LIVE, recordedAt: minutesAgo(2) },
        { riotMatchId: LIVE, recordedAt: minutesAgo(7) },
      ],
      NOW,
    );

    expect(captures).toHaveLength(1);
    expect(captures[0]?.detectedAt).toEqual(minutesAgo(7));
  });
});

describe("listLivePrematchGames", () => {
  test("reads the roster of each live capture from its archived snapshot", async () => {
    stubs.findMany.mockResolvedValue([
      { riotMatchId: LIVE, recordedAt: minutesAgo(5) },
    ]);
    stubs.readArchivedPrematchSnapshot.mockResolvedValue(
      snapshot(9101, ["a".repeat(78), null, "b".repeat(78)]),
    );

    const games = await listLivePrematchGames({
      now: NOW,
      completedMatchIds: () => Promise.resolve(new Set()),
    });

    // The query asks for prematch archive receipts inside the lifetime only.
    expect(stubs.findMany).toHaveBeenCalledWith({
      where: {
        kind: "raw-archive-prematch",
        recordedAt: { gt: new Date(NOW.getTime() - LIVE_GAME_TTL_MS) },
      },
      select: { riotMatchId: true, recordedAt: true },
    });
    expect(stubs.storedRawArchiveDescriptor).toHaveBeenCalledWith(
      expect.anything(),
      LIVE,
      "prematch",
    );
    expect(stubs.readArchivedPrematchSnapshot).toHaveBeenCalledWith(
      DESCRIPTOR,
      LIVE,
    );
    // A participant Riot reports without a puuid cannot be anyone's account.
    expect(games).toEqual([
      {
        riotMatchId: LIVE,
        gameId: "9101",
        detectedAt: minutesAgo(5),
        expiresAt: new Date(minutesAgo(5).getTime() + LIVE_GAME_TTL_MS),
        participantPuuids: ["a".repeat(78), "b".repeat(78)],
      },
    ]);
  });

  test("drops a completed game before reading its snapshot", async () => {
    stubs.findMany.mockResolvedValue([
      { riotMatchId: LIVE, recordedAt: minutesAgo(5) },
      { riotMatchId: FINISHED, recordedAt: minutesAgo(60) },
    ]);
    stubs.readArchivedPrematchSnapshot.mockResolvedValue(
      snapshot(9101, ["a".repeat(78)]),
    );
    const completedMatchIds = vi.fn(() =>
      Promise.resolve(new Set<string>([FINISHED])),
    );

    const games = await listLivePrematchGames({
      now: NOW,
      completedMatchIds,
    });

    expect(completedMatchIds).toHaveBeenCalledWith([LIVE, FINISHED]);
    expect(games.map((game) => game.riotMatchId)).toEqual([LIVE]);
    expect(stubs.readArchivedPrematchSnapshot).toHaveBeenCalledTimes(1);
  });

  test("asks nothing further when no capture is live", async () => {
    stubs.findMany.mockResolvedValue([]);
    const completedMatchIds = vi.fn(() => Promise.resolve(new Set<string>()));

    expect(
      await listLivePrematchGames({ now: NOW, completedMatchIds }),
    ).toEqual([]);
    expect(completedMatchIds).not.toHaveBeenCalled();
  });

  test("fails loudly on a receipt that names no snapshot", async () => {
    stubs.findMany.mockResolvedValue([
      { riotMatchId: LIVE, recordedAt: minutesAgo(5) },
    ]);
    stubs.storedRawArchiveDescriptor.mockResolvedValue(null);

    await expect(
      listLivePrematchGames({
        now: NOW,
        completedMatchIds: () => Promise.resolve(new Set()),
      }),
    ).rejects.toThrow("no archived snapshot descriptor");
  });
});
