import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  matchCoverageOf,
  type CanonicalMatch,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import type { EndOfGameBlockFixture } from "#src/testing/scout-client/end-of-game-fixtures.ts";
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
const { aliasedLcuBundle } =
  await import("#src/testing/report-lake/lcu-bundle-fixtures.ts");
const { classicEndOfGameBlock, classicGameflow, classicMatchId } =
  await import("#src/testing/scout-client/end-of-game-fixtures.ts");

const owner = DiscordAccountIdSchema.parse("160509172704739328");
const matchId = await classicMatchId();
const gameId = matchId.slice(matchId.indexOf("_") + 1);
const MINUTE = 60_000;
/** The measured default (`DEFAULT_SCOUT_CLIENT_END_OF_GAME_DEADLINE_SECONDS`). */
const DEADLINE_MS = 360_000;

function observerOf(block: EndOfGameBlockFixture): string {
  const observer = block.teams[0]?.players[0]?.puuid;
  if (observer === undefined) throw new Error("The fixture has players");
  return observer;
}

/** A second after `at`, so uploads order deterministically. */
function later(at: Date): Date {
  return new Date(at.getTime() + 1000);
}

const StoredPayloadSchema = z.object({ resource: z.string(), data: z.json() });
const sequences = new Map<string, number>();

/** Store one accepted observation the way ingress does, already translated. */
async function store(input: {
  deviceId: string;
  kind: "gameflow" | "post_game";
  observer: string;
  payload: unknown;
  receivedAt: Date;
}): Promise<string> {
  const sequence = (sequences.get(input.deviceId) ?? 0) + 1;
  sequences.set(input.deviceId, sequence);
  const observationId = crypto.randomUUID();
  await prisma.scoutClientObservation.create({
    data: {
      observationId,
      deviceId: input.deviceId,
      sequence: BigInt(sequence),
      capturedAt: input.receivedAt,
      receivedAt: input.receivedAt,
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: input.kind,
      localPuuid: input.observer,
      platformId: "NA1",
      gameId,
      payload: StoredPayloadSchema.parse(input.payload),
      bodyDigest: `digest-${observationId}`,
      disposition: "ACCEPTED",
    },
  });
  return observationId;
}

/** A device's gameflow session, then its end-of-game block alone. */
async function uploadEndOfGame(
  deviceId: string,
  receivedAt: Date,
  edit?: (block: EndOfGameBlockFixture) => void,
): Promise<string> {
  const block = await classicEndOfGameBlock();
  edit?.(block);
  const observer = observerOf(block);
  await store({
    deviceId,
    kind: "gameflow",
    observer,
    payload: classicGameflow(block),
    receivedAt,
  });
  return await store({
    deviceId,
    kind: "post_game",
    observer,
    payload: { resource: "post_game", data: block },
    receivedAt,
  });
}

async function uploadBundle(deviceId: string, receivedAt: Date) {
  const block = await classicEndOfGameBlock();
  return await store({
    deviceId,
    kind: "post_game",
    observer: observerOf(block),
    payload: {
      resource: "post_game",
      data: await aliasedLcuBundle("lcu-postgame-classic"),
    },
    receivedAt,
  });
}

function expectEndOfGame(match: CanonicalMatch | undefined) {
  expect(match === undefined ? null : matchCoverageOf(match.metadata)).toBe(
    "end_of_game",
  );
}

/** The same block, as a ranked game Riot would publish. */
function asRanked(block: EndOfGameBlockFixture) {
  block.queueType = "RANKED_SOLO_5x5";
  block.gameMode = "CLASSIC";
}

let deviceId: string;
beforeEach(async () => {
  io.fetchMatch.mockReset();
  // Riot never publishes League Classic: a definitive 404.
  io.fetchMatch.mockResolvedValue(undefined);
  sequences.clear();
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
    const block = await classicEndOfGameBlock();
    asRanked(block);
    const observer = observerOf(block);
    await store({
      deviceId,
      kind: "gameflow",
      observer,
      payload: classicGameflow(block, {
        queue: {
          id: 420,
          type: block.queueType,
          gameMode: block.gameMode,
          mapId: 11,
        },
      }),
      receivedAt: past,
    });
    await store({
      deviceId,
      kind: "post_game",
      observer,
      payload: { resource: "post_game", data: block },
      receivedAt: past,
    });
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
