import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import { readPrematchCoverage } from "./prematch-coverage.ts";

const { prisma } = createTestDatabase("scout-client-prematch-coverage");

const OWNER = DiscordAccountIdSchema.parse("160509172704739328");
const WINDOW = {
  observedSince: new Date("2026-10-08T00:00:00.000Z"),
  observedBefore: new Date("2026-10-08T12:00:00.000Z"),
};
let deviceId: string;
let sequence = 0;

/** The League client's session for a game in progress, as a device sent it. */
async function observeInProgress(
  gameId: string,
  options: { readonly custom: boolean; readonly receivedAt: Date },
): Promise<void> {
  sequence += 1;
  await prisma.scoutClientObservation.create({
    data: {
      observationId: crypto.randomUUID(),
      deviceId,
      sequence: BigInt(sequence),
      capturedAt: options.receivedAt,
      receivedAt: options.receivedAt,
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind: "gameflow",
      platformId: "NA1",
      gameId,
      payload: {
        resource: "gameflow_session",
        data: {
          phase: "InProgress",
          gameData: { gameId: Number(gameId), isCustomGame: options.custom },
        },
      },
      bodyDigest: crypto.randomUUID(),
      disposition: "ACCEPTED",
    },
  });
}

/** What Scout records when Spectator supplied the game's prematch. */
async function archivePrematch(riotMatchId: RiotMatchId): Promise<void> {
  await prisma.matchProcessingReceipt.create({
    data: {
      riotMatchId,
      kind: "raw-archive-prematch",
      version: 1,
      scopeKind: "global",
      scopeKey: "global",
      recordedAt: new Date("2026-10-08T06:00:00.000Z"),
    },
  });
}

beforeEach(async () => {
  await prisma.matchProcessingReceipt.deleteMany();
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.user.deleteMany();
  deviceId = await createTestScoutClientDevice(prisma, OWNER);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("readPrematchCoverage", () => {
  test("counts each observed game once and the ones with no prematch", async () => {
    const inWindow = new Date("2026-10-08T06:00:00.000Z");
    // A custom Spectator never returned, reported twice by the client.
    await observeInProgress("1001", { custom: true, receivedAt: inWindow });
    await observeInProgress("1001", { custom: true, receivedAt: inWindow });
    // A ranked game Spectator did return.
    await observeInProgress("1002", { custom: false, receivedAt: inWindow });
    await archivePrematch(RiotMatchIdSchema.parse("NA1_1002"));
    // Still inside the grace period: not counted yet.
    await observeInProgress("1003", {
      custom: false,
      receivedAt: new Date("2026-10-08T12:30:00.000Z"),
    });

    await expect(readPrematchCoverage(prisma, WINDOW)).resolves.toEqual({
      custom: { observed: 1, missing: 1 },
      matchmade: { observed: 1, missing: 0 },
    });
  });

  test("reads zero rather than nothing when no client saw a game", async () => {
    await expect(readPrematchCoverage(prisma, WINDOW)).resolves.toEqual({
      custom: { observed: 0, missing: 0 },
      matchmade: { observed: 0, missing: 0 },
    });
  });
});
