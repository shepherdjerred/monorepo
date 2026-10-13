import { afterAll, beforeEach, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  ScoutClientObservationKindSchema,
  ScoutClientObservationSchema,
} from "@scout-for-lol/data";
import type { ScoutClientObservation } from "#generated/prisma/client/index.js";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  rawObservationObject,
  receivedObservationEnvelope,
  observationArchiveEnvelope,
} from "./envelope.ts";

const { prisma } = createTestDatabase("client-raw-archive");
vi.doMock("#src/database/index.ts", async (original) => ({
  ...(await original()),
  prisma,
}));
const objects = new Map<string, ReturnType<typeof rawObservationObject>>();
const fail = new Set<string>();
const failAfterWrite = new Set<string>();
const write = vi.fn(async (row: ScoutClientObservation) => {
  if (fail.has(row.observationId)) throw new Error("Object store unavailable");
  const object = rawObservationObject(row);
  objects.set(row.observationId, object);
  if (failAfterWrite.has(row.observationId))
    throw new Error("Write acknowledgement lost");
  return {
    key: object.key,
    digest: object.digest,
    bytes: BigInt(object.bytes.length),
  };
});
vi.doMock("./object-store.ts", () => ({ persistRawObservation: write }));
const { reconcileRawClientObservations } = await import("./reconciliation.ts");
const owner = DiscordAccountIdSchema.parse("160509172704739328");
let deviceId: string;
let sequence = 0;

beforeEach(async () => {
  await prisma.scoutClientObservation.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.user.deleteMany();
  deviceId = await createTestScoutClientDevice(prisma, owner);
  objects.clear();
  fail.clear();
  failAfterWrite.clear();
  write.mockClear();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function seed(kind: string, quarantined = false, withEnvelope = false) {
  sequence += 1;
  const id = crypto.randomUUID();
  const payload = {
    resource: `fixture_${kind}`,
    data: {
      unknownFutureField: [0, null, { nested: "retained" }],
      gameId: 7101,
    },
  };
  const envelope = withEnvelope
    ? receivedObservationEnvelope(
        ScoutClientObservationSchema.parse({
          protocolVersion: 1,
          schemaVersion: 1,
          observationId: id,
          sequence,
          capturedAt: new Date().toISOString(),
          appVersion: "0.1.0",
          kind,
          localPuuid: "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e",
          payload,
        }),
      )
    : undefined;
  return await prisma.scoutClientObservation.create({
    data: {
      observationId: id,
      deviceId,
      sequence: BigInt(sequence),
      kind,
      payload,
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      capturedAt: new Date(),
      bodyDigest: "a".repeat(64),
      disposition: quarantined ? "QUARANTINED" : "ACCEPTED",
      quarantineReason: quarantined ? "observer_puuid_not_in_payload" : null,
      ...(envelope === undefined ? {} : { rawEnvelope: envelope }),
    },
  });
}

test("archives every kind and quarantined or superseded evidence without a canonical match", async () => {
  const kinds = ScoutClientObservationKindSchema.options;
  const rows = [];
  for (const kind of kinds) rows.push(await seed(kind, true));
  rows.push(await seed("post_game"));
  expect(await reconcileRawClientObservations()).toBe(rows.length);
  for (const row of rows) {
    const archived = await prisma.scoutClientObservation.findUniqueOrThrow({
      where: { observationId: row.observationId },
    });
    expect(archived.rawArchiveKey).toContain(`/observations/`);
    expect(archived.rawArchiveDigest).toHaveLength(64);
    expect(archived.rawArchivedAt).not.toBeNull();
    const object = objects.get(row.observationId);
    if (object === undefined) throw new Error("Observation was not written");
    expect(JSON.parse(new TextDecoder().decode(object.bytes))).toMatchObject({
      archiveVersion: 1,
      envelopeSource: "legacy_record",
      bodyDigest: row.bodyDigest,
      envelope: { kind: row.kind },
      payload: row.payload,
    });
  }
  expect(await reconcileRawClientObservations()).toBe(0);
  expect(write).toHaveBeenCalledTimes(rows.length);
});

test("preserves the original envelope and unknown payload fields through derived metadata changes", async () => {
  const row = await seed("gameflow", false, true);
  await prisma.scoutClientObservation.update({
    where: { observationId: row.observationId },
    data: { localPuuid: "p".repeat(78), platformId: "NA1" },
  });
  await reconcileRawClientObservations();
  const object = objects.get(row.observationId);
  if (object === undefined) throw new Error("Observation was not written");
  const archived = JSON.parse(new TextDecoder().decode(object.bytes));
  expect(archived).toEqual({
    archiveVersion: 1,
    deviceId,
    receivedAt: row.receivedAt.toISOString(),
    bodyDigest: row.bodyDigest,
    envelopeSource: "received",
    envelope: observationArchiveEnvelope(row).headers,
    payload: row.payload,
  });
});

test("failed objects remain durable and retry without starving other observations", async () => {
  const broken = await seed("clash");
  const healthy = await seed("post_game");
  fail.add(broken.observationId);
  await expect(reconcileRawClientObservations()).rejects.toThrow(
    "durable jobs remain pending",
  );
  expect(objects.has(healthy.observationId)).toBe(true);
  expect(
    await prisma.scoutClientObservation.findUniqueOrThrow({
      where: { observationId: broken.observationId },
    }),
  ).toMatchObject({ rawArchivedAt: null, rawArchiveClaimId: null });
  expect(await reconcileRawClientObservations()).toBe(0);
  fail.clear();
  expect(
    await reconcileRawClientObservations(new Date(Date.now() + 61_000)),
  ).toBe(1);
});

test("concurrent sweeps claim an observation once", async () => {
  await seed("clash");
  const results = await Promise.all([
    reconcileRawClientObservations(),
    reconcileRawClientObservations(),
  ]);
  expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
  expect(write).toHaveBeenCalledOnce();
});

test("an uncertain write retries identical scrubbed bytes even after legacy routing changes", async () => {
  const row = await seed("gameflow");
  await prisma.scoutClientObservation.update({
    where: { observationId: row.observationId },
    data: {
      payload: {
        unknown: [0, null, { kept: true, jwt: "synthetic-fixture" }],
        password: "synthetic-fixture",
      },
    },
  });
  failAfterWrite.add(row.observationId);
  await expect(reconcileRawClientObservations()).rejects.toThrow(
    "durable jobs remain pending",
  );
  const first = objects.get(row.observationId);
  if (first === undefined) throw new Error("Put was not attempted");
  expect(JSON.parse(new TextDecoder().decode(first.bytes))).toMatchObject({
    envelopeSource: "legacy_record",
    payload: { unknown: [0, null, { kept: true }] },
  });
  expect(new TextDecoder().decode(first.bytes)).not.toContain(
    "synthetic-fixture",
  );
  await prisma.scoutClientObservation.update({
    where: { observationId: row.observationId },
    data: { platformId: "NA1" },
  });
  failAfterWrite.clear();
  expect(
    await reconcileRawClientObservations(new Date(Date.now() + 61_000)),
  ).toBe(1);
  expect(objects.get(row.observationId)).toEqual(first);
});

test("bounded pages leave durable work for the next sweep", async () => {
  for (let index = 0; index < 101; index += 1) await seed("clash");
  expect(await reconcileRawClientObservations()).toBe(100);
  expect(
    await prisma.scoutClientObservation.count({
      where: { rawArchivedAt: null },
    }),
  ).toBe(1);
  expect(await reconcileRawClientObservations()).toBe(1);
});

test("a crashed claim becomes retryable and production leaves the archive queue untouched", async () => {
  const row = await seed("post_game");
  await prisma.scoutClientObservation.update({
    where: { observationId: row.observationId },
    data: {
      rawArchiveAttemptAt: new Date(),
      rawArchiveClaimId: "crashed",
      rawArchiveNextAttemptAt: new Date(Date.now() + 60_000),
    },
  });
  expect(await reconcileRawClientObservations()).toBe(0);
  expect(
    await reconcileRawClientObservations(new Date(Date.now() + 61_000)),
  ).toBe(1);
  await seed("clash");
  const previous = Bun.env["ENVIRONMENT"];
  Bun.env["ENVIRONMENT"] = "prod";
  resetConfigurationForTests();
  try {
    expect(await reconcileRawClientObservations()).toBe(0);
  } finally {
    if (previous === undefined) delete Bun.env["ENVIRONMENT"];
    else Bun.env["ENVIRONMENT"] = previous;
    resetConfigurationForTests();
  }
  expect(
    await prisma.scoutClientObservation.count({
      where: { rawArchivedAt: null },
    }),
  ).toBe(1);
});
