import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "./command-test-support.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { z } from "zod";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

test("two observed-absent v2 requests commit once; reads never create a target", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const input = await f.command({ action: "request" });
  expect(input.expected).toEqual({ mediaVersion: 0, targetVersion: null });
  expect(await db.mediaIntent.count({ where: { mediaId: f.media.id } })).toBe(
    0,
  );
  const results = await Promise.allSettled([
    f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), input),
    f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), input),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "version_conflict" },
  });
  expect(await db.mediaRequest.count({ where: { mediaId: f.media.id } })).toBe(
    1,
  );
  expect(await db.operation.count({ where: { targetId: f.media.id } })).toBe(1);
  expect(
    await db.applicationEvent.count({ where: { mediaId: f.media.id } }),
  ).toBe(1);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: input.scope },
    }),
  ).toMatchObject({ version: 0, generation: 1 });
});

test("a changed target alone rejects v2; replay retains the original committed versions", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const input = await f.command({ action: "request" });
  const key = crypto.randomUUID();
  const result = await f.service.executeDefaultCommand(f.actor, key, input);
  const keep = await f.command({ action: "keep" });
  await db.mediaIntent.update({
    where: { mediaId_edition: input.scope },
    data: { version: { increment: 1 } },
  });
  await expect(
    f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), keep),
  ).rejects.toMatchObject({ code: "version_conflict" });
  expect(await db.retentionHold.count({ where: { mediaId: f.media.id } })).toBe(
    0,
  );
  expect(await db.operation.count({ where: { targetId: f.media.id } })).toBe(1);
  expect(await f.service.executeDefaultCommand(f.actor, key, input)).toEqual(
    result,
  );
  expect(result.appliedVersions).toEqual({ mediaVersion: 1, targetVersion: 0 });
});

test("v1 and v2 Keep race preserves the legacy media CAS and commits one mutation", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    await f.command({ action: "request" }),
  );
  const input = await f.command({ action: "keep" });
  const results = await Promise.allSettled([
    f.service.act(f.actor, crypto.randomUUID(), f.media.id, {
      action: "keep",
      expectedVersion: input.expected.mediaVersion,
    }),
    f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), input),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "version_conflict" },
  });
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
  ).toMatchObject({ version: 2 });
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: input.scope },
    }),
  ).toMatchObject({ generation: 2, version: 1 });
});

test("strict protocol rejects named, mixed and target-absent effect commands", async () => {
  const f = await commandFixture(cluster.database);
  const input = await f.command({ action: "request" });
  for (const malformed of [
    { ...input, scope: { ...input.scope, edition: "extended" } },
    { ...input, command: { ...input.command, mediaId: f.media.id } },
    { ...input, command: { action: "keep", expectedVersion: 0 } },
    { ...input, command: { action: "retry" } },
    { ...input, actorId: f.actor.id },
  ])
    expect(DefaultCommandV2Schema.safeParse(malformed).success).toBe(false);
});

test.each(["v1", "v2"])(
  "%s pin rechecks owner after waiting on canonical media",
  async (protocol) => {
    const db = cluster.database;
    const f = await commandFixture(db, "owner");
    const input = await f.command({ action: "pin" });
    const held = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${f.media.id} FOR UPDATE`;
      held.resolve(undefined);
      await release.promise;
    });
    await held.promise;
    const result = capture(
      protocol === "v1"
        ? f.service.act(f.actor, crypto.randomUUID(), f.media.id, {
            action: "pin",
            expectedVersion: 0,
          })
        : f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), input),
    );
    try {
      await waitingOnMedia();
      await db.mediaUser.update({
        where: { id: f.actor.id },
        data: { role: "member" },
      });
    } finally {
      release.resolve(undefined);
      await blocker;
    }
    expect(await result).toMatchObject({
      error: { code: "forbidden", status: 403 },
    });
    expect(await db.mediaIntent.count({ where: { mediaId: f.media.id } })).toBe(
      0,
    );
    expect(
      await db.retentionHold.count({ where: { mediaId: f.media.id } }),
    ).toBe(0);
    expect(await db.operation.count({ where: { targetId: f.media.id } })).toBe(
      0,
    );
  },
);

test("selected roots lock in canonical order before primary target CAS or creation", async () => {
  const db = cluster.database;
  const f = await commandFixture(db, "owner");
  const other = await db.mediaItem.create({
    data: { kind: "movie", title: "Second root" },
  });
  const ordered = [f.media.id, other.id].sort();
  const first = ordered[0];
  const primary = ordered[1];
  if (first === undefined || primary === undefined)
    throw new Error("Fixture roots missing");
  await createTestDefaultTarget(db, primary);
  const candidate = await db.releaseCandidate.create({
    data: {
      providerId: "lock-proof",
      providerReleaseId: crypto.randomUUID(),
      title: "Selected roots",
      mediaIds: [primary, first],
      attributes: {},
      evaluation: {},
    },
  });
  const input = DefaultCommandV2Schema.parse({
    schemaVersion: 2,
    scope: { mediaId: primary, edition: "default" },
    expected: { mediaVersion: 1, targetVersion: 0 },
    command: { action: "select_release", releaseId: candidate.id },
  });
  const held = Promise.withResolvers<undefined>();
  const probe = Promise.withResolvers<undefined>();
  const blocker = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${first} FOR UPDATE`;
    held.resolve(undefined);
    await probe.promise;
    // A primary-first prelude would already hold this later root and fail NOWAIT.
    await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${primary} FOR UPDATE NOWAIT`;
  });
  await held.promise;
  const result = capture(
    f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), input),
  );
  try {
    await waitingOnMedia();
  } finally {
    probe.resolve(undefined);
    await blocker;
  }
  expect(await result).toMatchObject({ error: { code: "version_conflict" } });
  expect(await db.mediaIntent.count({ where: { mediaId: first } })).toBe(0);
  expect(await db.operation.count({ where: { targetId: primary } })).toBe(0);
});

async function waitingOnMedia(minimum = 1) {
  await expect
    .poll(async () => {
      const rows = await cluster.database.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
      AND query LIKE '%FROM "MediaItem"%'
    `;
      return Number(rows[0]?.waiting ?? 0);
    })
    .toBeGreaterThanOrEqual(minimum);
}

async function capture(promise: Promise<unknown>) {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

test("v2 root cancellation races actual paginated expansion without retaining effective leaf authority", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { kind: "series", externalIds: { plexSectionId: "2" } },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Covered leaf",
      parentId: f.media.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  const created = await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    await f.command({ action: "request" }),
  );
  const requestId = z.uuid().parse(created.result.requestId);
  const operationId = z.uuid().parse(created.result.operationId);
  const cancel = await f.command({
    action: "cancel_request",
    requestId,
    requestVersion: 0,
  });
  const held = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const blocker = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${f.media.id} FOR UPDATE`;
    held.resolve(undefined);
    await release.promise;
  });
  await held.promise;
  const expansion = capture(
    createCoverageActivities({ db }).expandMediaRequest({
      requestId,
      requestVersion: 0,
      operationId,
      cursor: null,
    }),
  );
  const cancellation = capture(
    f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), cancel),
  );
  try {
    await waitingOnMedia(2);
  } finally {
    release.resolve(undefined);
    await blocker;
  }
  expect(await expansion).not.toHaveProperty("error");
  expect(await cancellation).toMatchObject({
    value: { appliedVersions: { mediaVersion: 2, targetVersion: 1 } },
  });
  expect(
    await db.mediaRequest.findUniqueOrThrow({ where: { id: requestId } }),
  ).toMatchObject({ active: false, excluded: true, version: 1 });
  expect(
    await db.mediaRequest.count({
      where: { mediaId: episode.id, ...effectiveRequestWhere },
    }),
  ).toBe(0);
  const context = await f.service.getDefaultCommandContext(f.actor, episode.id);
  expect(context.allowedProtectiveActions).not.toContain("keep");
});
