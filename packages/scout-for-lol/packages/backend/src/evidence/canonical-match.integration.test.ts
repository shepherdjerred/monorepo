import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  matchCoverageOf,
  type CanonicalMatch,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import { makeRiotTransportFailure } from "#src/testing/riot-mocks.ts";
import type { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";

const { prisma } = createTestDatabase("scout-canonical-end-of-game");
const io = vi.hoisted(() => ({
  fetchMatch: vi.fn<typeof fetchMatchData>(),
}));
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: () => false,
}));
vi.mock("#src/league/tasks/postmatch/match-data-fetcher.ts", () => ({
  fetchMatchData: io.fetchMatch,
}));

const { resolveCanonicalMatch, resolveCompleteMatch } =
  await import("./matches.ts");
const { readSelectedLocalCanonicalMatch } =
  await import("#src/scout-client/canonical-match.ts");
const { classicMatchId } =
  await import("#src/testing/scout-client/end-of-game-fixtures.ts");
const {
  END_OF_GAME_DEADLINE_MS: DEADLINE_MS,
  asRanked,
  endOfGameUploads,
  rankedGameflow,
} = await import("#src/testing/scout-client/end-of-game-uploads.ts");

const owner = DiscordAccountIdSchema.parse("160509172704739328");
const matchId = await classicMatchId();
const MINUTE = 60_000;
const uploads = endOfGameUploads(prisma, matchId);
const { uploadEndOfGame, uploadBundle } = uploads;

/** A second after `at`, so uploads order deterministically. */
function later(at: Date): Date {
  return new Date(at.getTime() + 1000);
}

function expectEndOfGame(match: CanonicalMatch | undefined) {
  expect(match === undefined ? null : matchCoverageOf(match.metadata)).toBe(
    "end_of_game",
  );
}

let deviceId: string;
beforeEach(async () => {
  io.fetchMatch.mockReset();
  // Riot never publishes League Classic: a definitive 404.
  io.fetchMatch.mockResolvedValue(undefined);
  uploads.reset();
  await prisma.$transaction([
    prisma.scoutClientCanonicalMatch.deleteMany(),
    prisma.scoutClientObservation.deleteMany(),
    prisma.scoutClientDevice.deleteMany(),
    prisma.scoutClientPairing.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  deviceId = await createTestScoutClientDevice(prisma, owner);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveCanonicalMatch on an end-of-game-only game", () => {
  test("freezes the record after its deadline, with its observation as provenance", async () => {
    const observationId = await uploadEndOfGame(
      deviceId,
      new Date(Date.now() - DEADLINE_MS - MINUTE),
    );

    const resolution = await resolveCanonicalMatch(matchId);

    expect(resolution).toMatchObject({
      kind: "available",
      coverage: "partial",
      frozen: true,
      evidence: [{ source: "SCOUT_CLIENT", sourceId: observationId }],
    });
    expectEndOfGame(
      resolution.kind === "available" ? resolution.value : undefined,
    );
    const selection = await prisma.scoutClientCanonicalMatch.findUnique({
      where: { riotMatchId: matchId },
      include: { sourceObservation: { select: { deviceId: true } } },
    });
    expect(selection).toMatchObject({
      sourceObservationId: observationId,
      sourceObservation: { deviceId },
    });
    // Frozen, and no complete match is ever owed for it.
    expect(await resolveCompleteMatch(matchId)).toMatchObject({
      kind: "unavailable",
    });
    expect(await readSelectedLocalCanonicalMatch(matchId)).toBeNull();
    expect(await resolveCanonicalMatch(matchId)).toEqual(resolution);
  });

  test("waits out the deadline for the history bundle and aliases", async () => {
    const receivedAt = new Date();
    await uploadEndOfGame(deviceId, receivedAt);

    expect(await resolveCanonicalMatch(matchId)).toEqual({
      kind: "pending",
      retryAt: new Date(receivedAt.getTime() + DEADLINE_MS).toISOString(),
    });
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);
  });

  test("a history bundle before the deadline is the game's only record", async () => {
    await uploadEndOfGame(deviceId, new Date());
    const bundleId = await uploadBundle(deviceId, new Date());

    const resolution = await resolveCanonicalMatch(matchId);

    expect(resolution).toMatchObject({
      kind: "available",
      coverage: "complete",
      evidence: [{ source: "SCOUT_CLIENT", sourceId: bundleId }],
    });
    expect(
      await prisma.scoutClientCanonicalMatch.findMany({
        select: { sourceObservationId: true },
      }),
    ).toEqual([{ sourceObservationId: bundleId }]);
  });

  test("a bundle after the freeze never upgrades the record", async () => {
    const observationId = await uploadEndOfGame(
      deviceId,
      new Date(Date.now() - DEADLINE_MS - MINUTE),
    );
    expect(await resolveCanonicalMatch(matchId)).toMatchObject({
      kind: "available",
      coverage: "partial",
    });
    await uploadBundle(deviceId, new Date());

    expect(await resolveCanonicalMatch(matchId)).toMatchObject({
      kind: "available",
      coverage: "partial",
      evidence: [{ sourceId: observationId }],
    });
  });

  test("two clients that disagree produce no record", async () => {
    const past = new Date(Date.now() - DEADLINE_MS - MINUTE);
    const first = await uploadEndOfGame(deviceId, past);
    const other = await createTestScoutClientDevice(prisma, owner);
    const second = await uploadEndOfGame(other, later(past), (block) => {
      const stats = block.teams[0]?.players[0]?.stats;
      if (stats === undefined) throw new Error("The fixture has players");
      stats["assists"] = Number(stats["assists"]) + 1;
    });

    expect(await resolveCanonicalMatch(matchId)).toEqual({
      kind: "conflict",
      evidence: [
        { source: "SCOUT_CLIENT", sourceId: first },
        { source: "SCOUT_CLIENT", sourceId: second },
      ],
    });
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);
  });

  test("two clients that agree produce one record", async () => {
    const past = new Date(Date.now() - DEADLINE_MS - MINUTE);
    const first = await uploadEndOfGame(deviceId, past);
    await uploadEndOfGame(
      await createTestScoutClientDevice(prisma, owner),
      later(past),
    );

    expect(await resolveCanonicalMatch(matchId)).toMatchObject({
      kind: "available",
      evidence: [{ sourceId: first }],
    });
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(1);
  });

  test("an undecided Riot read never freezes a game Riot publishes", async () => {
    const past = new Date(Date.now() - DEADLINE_MS - MINUTE);
    await uploadEndOfGame(deviceId, past, asRanked, rankedGameflow);
    io.fetchMatch.mockRejectedValue(makeRiotTransportFailure());

    expect(await resolveCanonicalMatch(matchId)).toMatchObject({
      kind: "pending",
    });
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(0);

    // Once Riot definitively lacks it, the record stands in.
    io.fetchMatch.mockResolvedValue(undefined);
    expect(await resolveCanonicalMatch(matchId)).toMatchObject({
      kind: "available",
      coverage: "partial",
    });
  });
});
