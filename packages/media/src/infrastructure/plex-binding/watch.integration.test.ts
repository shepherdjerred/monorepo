import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import {
  plexBindingFixture,
  bindingTestExecution,
} from "#automation/plex-binding/test-fixture.ts";
import { queueExistingPlexBinding } from "#automation/plex-binding/queue.ts";
import { createPlexBindingActivities } from "#automation/plex-binding/activities.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { readCurrentPlexBinding } from "./read.ts";
import { commitBoundWatch, readCurrentBoundWatch } from "./watch.ts";
import { plexBindingFreshness } from "./freshness.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/** Actual file publication and cold verifier; requester watch values are explicit DB-boundary inputs. */
async function fixture() {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context());
  directories.push(f.files.directory);
  const queued = await queueExistingPlexBinding(f.context, f.asset.id);
  if (queued.status !== "queued")
    throw new Error(`Cold watch fixture protected: ${queued.reason}`);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: queued.operationId },
  });
  expect(
    await createPlexBindingActivities(f.context).reverify(
      ReverifyPlexBindingInputSchema.parse(operation.payload),
      bindingTestExecution(),
    ),
  ).toEqual({ status: "verified", bindingCount: 1 });
  const scope = { mediaId: f.files.media.id, edition: "default" as const };
  const access = await f.context.plexAccess("movie");
  const current = await db.$transaction((tx) =>
    readCurrentPlexBinding(tx, { scope, assetId: f.asset.id, access }),
  );
  if (current.status !== "current")
    throw new Error(`Current watch fixture protected: ${current.reason}`);
  const authority = {
    purpose: "current_serving" as const,
    binding: current.snapshot,
  };
  await db.watchObservationFence.upsert({
    where: { mediaId_edition: scope },
    create: scope,
    update: {},
  });
  return { ...f, db, scope, authority, userId: f.files.user.id };
}

async function observe(
  f: Awaited<ReturnType<typeof fixture>>,
  watched: boolean | null,
  revision?: bigint,
) {
  const observedAt = new Date();
  await f.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "mediaId" FROM "WatchObservationFence" WHERE "mediaId"=${f.scope.mediaId} AND edition='default' FOR UPDATE`;
    const fence = await tx.watchObservationFence.update({
      where: { mediaId_edition: f.scope },
      data: { issuedRevision: revision ?? { increment: 1 } },
    });
    const observed = { wall: Date.now(), monotonic: performance.now() };
    await commitBoundWatch(
      tx,
      {
        userId: f.userId,
        authority: f.authority,
        watched,
        observedAt,
        watchBatchRevision: fence.issuedRevision,
      },
      plexBindingFreshness({
        observed,
        expiresAtMs: observed.wall + 60_000,
        guards: [],
      }),
    );
    await tx.watchObservationFence.update({
      where: { mediaId_edition: f.scope },
      data: { settledRevision: fence.issuedRevision },
    });
  });
}

test("bound watch preserves full BigInt revision and unknown deletes both stored projections", async () => {
  const f = await fixture();
  await observe(f, false, 9_007_199_254_740_993n);
  const result = await f.db.$transaction((tx) => readCurrentBoundWatch(tx, f));
  expect(result).toMatchObject({
    status: "known",
    projection: { watched: false, watchBatchRevision: "9007199254740993" },
  });
  await observe(f, null);
  expect(await f.db.$transaction((tx) => readCurrentBoundWatch(tx, f))).toEqual(
    { status: "unknown", reason: "missing" },
  );
  expect(
    await f.db.watchState.count({ where: { userId: f.userId, ...f.scope } }),
  ).toBe(0);
  expect(
    await f.db.plexWatchProjection.count({
      where: { userId: f.userId, ...f.scope },
    }),
  ).toBe(0);
});

test("legacy watch row or later literal value drift cannot provide current bound knowledge", async () => {
  const f = await fixture();
  const key = { userId: f.userId, ...f.scope };
  await f.db.watchState.create({
    data: {
      ...key,
      watched: true,
      source: "plex_current",
      observedAt: new Date(),
    },
  });
  expect(await f.db.$transaction((tx) => readCurrentBoundWatch(tx, f))).toEqual(
    { status: "unknown", reason: "missing" },
  );
  await observe(f, true);
  await f.db.watchState.update({
    where: { userId_mediaId_edition: key },
    data: { watched: false },
  });
  expect(await f.db.$transaction((tx) => readCurrentBoundWatch(tx, f))).toEqual(
    { status: "unknown", reason: "value_changed" },
  );
});

test("same literal watch row loses authority when its physical asset version changes", async () => {
  const f = await fixture();
  await observe(f, true);
  const before = await f.db.watchState.findUniqueOrThrow({
    where: { userId_mediaId_edition: { userId: f.userId, ...f.scope } },
  });
  await f.db.libraryAsset.update({
    where: { id: f.asset.id },
    data: { version: { increment: 1 } },
  });
  expect(await f.db.$transaction((tx) => readCurrentBoundWatch(tx, f))).toEqual(
    { status: "unknown", reason: "authority_changed" },
  );
  expect(
    await f.db.watchState.findUniqueOrThrow({
      where: { userId_mediaId_edition: { userId: f.userId, ...f.scope } },
    }),
  ).toEqual(before);
  await expect(observe(f, false)).rejects.toMatchObject({
    reason: "ownership_changed",
  });
  await observe(f, null);
  expect(
    await f.db.watchState.count({ where: { userId: f.userId, ...f.scope } }),
  ).toBe(0);
  expect(
    await f.db.plexWatchProjection.count({
      where: { userId: f.userId, ...f.scope },
    }),
  ).toBe(0);
});

test("unknown from the current batch clears retained WatchState after real association replacement", async () => {
  const f = await fixture();
  await observe(f, true);
  const part = f.item.Media[0]?.Part[0];
  if (part === undefined)
    throw new Error("Watch fixture omitted its real asset Part");
  part.id += 1_000_000;
  const queued = await queueExistingPlexBinding(f.context, f.asset.id);
  if (queued.status !== "queued")
    throw new Error(`Replacement fixture protected: ${queued.reason}`);
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: queued.operationId },
  });
  expect(
    await createPlexBindingActivities(f.context).reverify(
      ReverifyPlexBindingInputSchema.parse(operation.payload),
      bindingTestExecution(),
    ),
  ).toEqual({ status: "verified", bindingCount: 1 });
  const access = await f.context.plexAccess("movie");
  const current = await f.db.$transaction((tx) =>
    readCurrentPlexBinding(tx, {
      scope: f.scope,
      assetId: f.asset.id,
      access,
    }),
  );
  if (current.status !== "current")
    throw new Error(`Replacement binding protected: ${current.reason}`);
  expect(current.snapshot.revision).toBe(f.authority.binding.revision + 1);
  expect(current.snapshot.associationHash).not.toBe(
    f.authority.binding.associationHash,
  );
  expect(
    await f.db.watchState.count({ where: { userId: f.userId, ...f.scope } }),
  ).toBe(1);
  expect(
    await f.db.plexWatchProjection.count({
      where: { userId: f.userId, ...f.scope },
    }),
  ).toBe(0);
  await observe(f, null);
  expect(
    await f.db.watchState.count({ where: { userId: f.userId, ...f.scope } }),
  ).toBe(0);
  expect(
    await f.db.plexWatchProjection.count({
      where: { userId: f.userId, ...f.scope },
    }),
  ).toBe(0);
});

test("stale unknown token cannot clear a newer settled watch winner", async () => {
  const f = await fixture();
  await observe(f, true);
  const stale = await f.db.watchObservationFence.findUniqueOrThrow({
    where: { mediaId_edition: f.scope },
  });
  await observe(f, false);
  const key = { userId: f.userId, ...f.scope };
  const before = {
    watch: await f.db.watchState.findUniqueOrThrow({
      where: { userId_mediaId_edition: key },
    }),
    projection: await f.db.plexWatchProjection.findUniqueOrThrow({
      where: { userId_mediaId_edition: key },
    }),
    fence: await f.db.watchObservationFence.findUniqueOrThrow({
      where: { mediaId_edition: f.scope },
    }),
  };
  await expect(
    f.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "mediaId" FROM "WatchObservationFence" WHERE "mediaId"=${f.scope.mediaId} AND edition='default' FOR UPDATE`;
      const observed = { wall: Date.now(), monotonic: performance.now() };
      await commitBoundWatch(
        tx,
        {
          userId: f.userId,
          authority: f.authority,
          watched: null,
          observedAt: new Date(),
          watchBatchRevision: stale.issuedRevision,
        },
        plexBindingFreshness({
          observed,
          expiresAtMs: observed.wall + 60_000,
          guards: [],
        }),
      );
    }),
  ).rejects.toMatchObject({ reason: "scope_changed" });
  expect(
    await f.db.watchState.findUniqueOrThrow({
      where: { userId_mediaId_edition: key },
    }),
  ).toEqual(before.watch);
  expect(
    await f.db.plexWatchProjection.findUniqueOrThrow({
      where: { userId_mediaId_edition: key },
    }),
  ).toEqual(before.projection);
  expect(
    await f.db.watchObservationFence.findUniqueOrThrow({
      where: { mediaId_edition: f.scope },
    }),
  ).toEqual(before.fence);
});
