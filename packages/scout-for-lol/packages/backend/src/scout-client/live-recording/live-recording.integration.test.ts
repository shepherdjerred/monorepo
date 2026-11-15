import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  ScoutClientObservationBatchSchema,
} from "@scout-for-lol/data";
import fixtures from "@scout-for-lol/data/scout-client/live-game-recording.fixtures.json" with { type: "json" };
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client/scout-client-device.ts";
import type { AuthenticatedScoutClient } from "#src/scout-client/access/authentication.ts";

const { prisma } = createTestDatabase("scout-client-live-recording");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const { ingestObservationBatch } = await import("#src/scout-client/ingress.ts");
const { ScoutClientLiveRecordingRefused } = await import("./live-recording.ts");

const OWNER_ID = DiscordAccountIdSchema.parse("160509172704739328");
let device: AuthenticatedScoutClient;

function recordingBatch(payload: unknown) {
  return ScoutClientObservationBatchSchema.parse({
    observations: [
      {
        protocolVersion: 1,
        schemaVersion: 1,
        observationId: crypto.randomUUID(),
        sequence: 1,
        capturedAt: new Date().toISOString(),
        appVersion: "0.1.0",
        kind: "live_game_recording",
        gameId: "5653248720",
        payload,
      },
    ],
  });
}

beforeEach(async () => {
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDeviceVersion.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.user.deleteMany();
  device = {
    deviceId: await createTestScoutClientDevice(prisma, OWNER_ID, {
      appVersion: "0.1.0",
    }),
    ownerId: OWNER_ID,
    appVersion: "0.1.0",
  };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ingesting a live game recording", () => {
  test("stores it under the uploading device and owner", async () => {
    const receipts = await ingestObservationBatch(
      device,
      recordingBatch(fixtures.recording),
    );
    expect(receipts.map((receipt) => receipt.outcome)).toEqual(["accepted"]);
    const stored = await prisma.scoutClientObservation.findMany({
      select: { kind: true, deviceId: true, payload: true, gameId: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: "live_game_recording",
      deviceId: device.deviceId,
      gameId: "5653248720",
    });
    const owner = await prisma.scoutClientDevice.findUnique({
      where: { id: device.deviceId },
      select: { ownerId: true },
    });
    expect(owner?.ownerId).toBe(OWNER_ID);
  });

  test("answers a retry of the same observation as already accepted", async () => {
    const batch = recordingBatch(fixtures.recording);
    await ingestObservationBatch(device, batch);
    const again = await ingestObservationBatch(device, batch);
    expect(again.map((receipt) => receipt.outcome)).toEqual([
      "already_accepted",
    ]);
  });

  test("stores nothing from a recording that carries a Riot ID", async () => {
    const damaged = structuredClone(fixtures.recording);
    Object.assign(damaged.data.samples[0]?.snapshot.participants[0] ?? {}, {
      riotId: "Someone#NA1",
    });
    await expect(
      ingestObservationBatch(device, recordingBatch(damaged)),
    ).rejects.toBeInstanceOf(ScoutClientLiveRecordingRefused);
    expect(await prisma.scoutClientObservation.count()).toBe(0);
  });
});
