import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

test.each(["v1", "v2"])(
  "a %s key cannot execute the other protocol and replays its original result after Keep",
  async (firstProtocol) => {
    const db = cluster.database;
    const actor = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Protocol requester",
      },
    });
    const media = await db.mediaItem.create({
      data: { kind: "movie", title: "Protocol compatibility" },
    });
    await db.plexIdentityMapping.create({
      data: {
        userId: actor.id,
        serverMachineId: "fixture-server",
        serverAccountId: actor.plexAccountId,
        kind: "account",
        permittedSectionIds: ["1"],
        permittedMediaKinds: ["movie"],
        verifiedAt: new Date(),
      },
    });
    const app = new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
    });
    const input = {
      mediaId: media.id,
      subtitleLanguages: [],
      includeSpecials: false,
    };
    const v2 = DefaultCommandV2Schema.parse({
      schemaVersion: 2,
      scope: { mediaId: media.id, edition: "default" },
      expected: { mediaVersion: 0, targetVersion: null },
      command: {
        action: "request",
        subtitleLanguages: [],
        includeSpecials: false,
      },
    });
    const key = crypto.randomUUID();
    const original =
      firstProtocol === "v1"
        ? await app.createRequest(actor, key, input)
        : await app.executeDefaultCommand(actor, key, v2);
    const before = await db.idempotencyRecord.findUniqueOrThrow({
      where: { userId_key: { userId: actor.id, key } },
    });
    await expect(
      firstProtocol === "v1"
        ? app.executeDefaultCommand(actor, key, v2)
        : app.createRequest(actor, key, input),
    ).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    expect(await db.operation.count({ where: { targetId: media.id } })).toBe(1);
    expect(await db.mediaRequest.count({ where: { mediaId: media.id } })).toBe(
      1,
    );
    await app.act(actor, crypto.randomUUID(), media.id, {
      action: "keep",
      expectedVersion: 1,
    });
    const replay =
      firstProtocol === "v1"
        ? await app.createRequest(actor, key, input)
        : await app.executeDefaultCommand(actor, key, v2);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(original));
    expect(
      await db.idempotencyRecord.findUniqueOrThrow({
        where: { userId_key: { userId: actor.id, key } },
      }),
    ).toEqual(before);
    expect(await db.operation.count({ where: { targetId: media.id } })).toBe(2);
    if (firstProtocol === "v2")
      expect(replay).toMatchObject({
        appliedVersions: { mediaVersion: 1, targetVersion: 0 },
      });
  },
);

// Captured against c1c74c2 before the v2 command refactor. These literals must
// not be regenerated from the new command canonicalizer or response schema.
const mediaId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const requestInput = {
  mediaId,
  subtitleLanguages: ["en"],
  includeFutureEpisodes: false,
  includeSpecials: false,
};
const requestResponse = {
  requestId,
  mediaId,
  operationId: "30000000-0000-4000-8000-000000000001",
  status: "queued",
};
const keepResponse = {
  operationId: "30000000-0000-4000-8000-000000000002",
  status: "queued",
  version: 2,
};
const cancelResponse = {
  requestId,
  operationId: "30000000-0000-4000-8000-000000000003",
  status: "queued",
};

test("literal v1 request, Keep and cancellation hashes and saved responses survive later state changes", async () => {
  const db = cluster.database;
  const actor = await db.mediaUser.create({
    data: { plexAccountId: "v1-compat-account", displayName: "Requester" },
  });
  await db.mediaItem.create({
    data: { id: mediaId, kind: "movie", title: "Compatibility" },
  });
  await createTestDefaultTarget(db, mediaId);
  await db.mediaRequest.create({
    data: { id: requestId, userId: actor.id, mediaId },
  });
  await db.plexIdentityMapping.create({
    data: {
      userId: actor.id,
      serverMachineId: "fixture-server",
      serverAccountId: actor.plexAccountId,
      kind: "account",
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      verifiedAt: new Date(),
    },
  });
  const app = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
  const random = vi.spyOn(globalThis.crypto, "randomUUID");
  try {
    random.mockReturnValue("30000000-0000-4000-8000-000000000001");
    expect(await app.createRequest(actor, "v1-request", requestInput)).toEqual(
      requestResponse,
    );
    random.mockReturnValue("30000000-0000-4000-8000-000000000002");
    expect(
      await app.act(actor, "v1-keep", mediaId, {
        action: "keep",
        expectedVersion: 1,
      }),
    ).toEqual(keepResponse);
    random.mockReturnValue("30000000-0000-4000-8000-000000000003");
    expect(await app.cancelRequest(actor, "v1-cancel", requestId, 1)).toEqual(
      cancelResponse,
    );
  } finally {
    random.mockRestore();
  }
  for (const [key, requestHash, response] of [
    [
      "v1-request",
      "f4ff3b4e19e3c7f51a5733939268541f5bf5587d13c1712583d5e33cb33ca320",
      requestResponse,
    ],
    [
      "v1-keep",
      "64aa58f274fc60154ac70f0a0f7eab77f69911a0f3ac83bd83896c279178449f",
      keepResponse,
    ],
    [
      "v1-cancel",
      "78e953012a0f96a0f20ae33844560c870d15fef3abde1c0086a9397b54c2d2be",
      cancelResponse,
    ],
  ] as const) {
    const saved = await db.idempotencyRecord.findUniqueOrThrow({
      where: { userId_key: { userId: actor.id, key } },
    });
    expect(saved).toMatchObject({ requestHash, response });
  }
  const operations = await db.operation.findMany({
    where: { targetId: mediaId },
    orderBy: { id: "asc" },
    include: { outbox: true },
  });
  expect(operations).toHaveLength(3);
  expect(operations.map((row) => row.payload)).toEqual([
    {
      operationId: requestResponse.operationId,
      kind: "reconcile_media",
      mediaId,
      generation: 1,
      recoveryEpoch: 0,
      requestId,
      requestVersion: 1,
      cursor: null,
    },
    {
      operationId: keepResponse.operationId,
      kind: "reconcile_media",
      mediaId,
      generation: 2,
      recoveryEpoch: 0,
      action: "keep",
    },
    {
      operationId: cancelResponse.operationId,
      kind: "reconcile_media",
      mediaId,
      generation: 3,
      recoveryEpoch: 0,
      requestId,
      requestVersion: 2,
      cursor: null,
    },
  ]);
  for (const row of operations)
    expect(row.outbox?.payload).toEqual(row.payload);
  const intent = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId, edition: "default" } },
  });
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 7 },
  });
  await db.mediaUser.update({
    where: { id: actor.id },
    data: { restricted: true },
  });
  expect(
    JSON.stringify(await app.createRequest(actor, "v1-request", requestInput)),
  ).toBe(
    '{"operationId":"30000000-0000-4000-8000-000000000001","requestId":"20000000-0000-4000-8000-000000000001","mediaId":"10000000-0000-4000-8000-000000000001","status":"queued"}',
  );
  expect(
    JSON.stringify(
      await app.act(actor, "v1-keep", mediaId, {
        action: "keep",
        expectedVersion: 1,
      }),
    ),
  ).toBe(
    '{"operationId":"30000000-0000-4000-8000-000000000002","status":"queued","version":2}',
  );
  expect(
    JSON.stringify(await app.cancelRequest(actor, "v1-cancel", requestId, 1)),
  ).toBe(
    '{"operationId":"30000000-0000-4000-8000-000000000003","requestId":"20000000-0000-4000-8000-000000000001","status":"queued"}',
  );
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId, edition: "default" } },
    }),
  ).toEqual(intent);
  expect(
    await db.operation.findMany({
      where: { targetId: mediaId },
      orderBy: { id: "asc" },
      include: { outbox: true },
    }),
  ).toEqual(operations);
});
