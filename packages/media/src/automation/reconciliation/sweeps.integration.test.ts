import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { sweepDownloads } from "./downloads.ts";
import { sweepInventory } from "./inventory.ts";
import { sweepFeeds } from "./feeds.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";

const { database, context, fixture } = automationTestHarness();

test("terminated coordinator after reservation commit is recovered once and adopts the same acquisition", async () => {
  const f = await fixture();
  const ctx = context();
  const activities = createAcquisitionActivities(ctx);
  const reserved = await activities.reconcileMediaIntent(f.input);
  if (reserved.attemptId === null) throw new Error("No acquisition reserved");
  const attemptId = reserved.attemptId;
  ctx.describeWorkflow = async (id) =>
    id === `media-operation-${f.input.operationId}`
      ? { status: "TERMINATED", runId: "root-terminal-run" }
      : id === `media-acquire-${attemptId}`
        ? null
        : { status: "RUNNING", runId: "other" };
  await sweepDownloads(ctx, null);
  await sweepDownloads(ctx, null);
  const recovery = await database().operation.findMany({
    where: { idempotencyKey: { startsWith: `recover:${attemptId}:` } },
  });
  expect(recovery).toHaveLength(1);
  const operation = recovery[0];
  if (operation === undefined) throw new Error("Recovery absent");
  expect(
    await activities.reconcileMediaIntent({
      ...f.input,
      operationId: operation.id,
    }),
  ).toMatchObject({ status: "acquire", attemptId });
  expect(
    await database().acquisitionAttempt.count({
      where: { mediaIds: { has: f.media.id } },
    }),
  ).toBe(1);
});

test("running child, unknown Temporal history, and old recovery epochs cannot authorize takeover", async () => {
  const f = await fixture();
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", {
        headers: { "set-cookie": "QBT_SID_8080=fixture; Path=/" },
      });
    if (url.pathname.endsWith("/torrents/info")) return Response.json([]);
    throw new Error("Unexpected recovery observation request");
  });
  const reserved = await createAcquisitionActivities(ctx).reconcileMediaIntent(
    f.input,
  );
  if (reserved.attemptId === null) throw new Error("No acquisition");
  const attemptId = reserved.attemptId;
  ctx.describeWorkflow = async (id) =>
    id === `media-operation-${f.input.operationId}`
      ? { status: "FAILED", runId: "failed-root" }
      : { status: "RUNNING", runId: "active-child" };
  await sweepDownloads(ctx, null);
  expect(
    await database().operation.count({
      where: { idempotencyKey: { startsWith: `recover:${attemptId}:` } },
    }),
  ).toBe(0);
  await database().acquisitionAttempt.update({
    where: { id: attemptId },
    data: { state: "submission_unknown" },
  });
  ctx.describeWorkflow = async (id) =>
    id === `media-operation-${f.input.operationId}`
      ? { status: "TERMINATED", runId: "failed-root" }
      : null;
  await sweepDownloads(ctx, null);
  expect(
    await database().operation.count({
      where: { idempotencyKey: { startsWith: `recover:${attemptId}:` } },
    }),
  ).toBe(0);
  await prepareMediaRestore(database(), {
    recoveryId: crypto.randomUUID(),
    expectedEpoch: 0,
    reason: "isolated backup recovery",
  });
  ctx.describeWorkflow = async () => {
    throw new Error("Observe mode must not query Temporal for takeover");
  };
  await sweepDownloads(ctx, null);
  expect(
    await database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    }),
  ).toMatchObject({ state: "submission_unknown", recoveryEpoch: 0 });
});

test("inventory persists bounded Plex pages without adopting foreign files; absent paths require completed enumeration", async () => {
  const f = await fixture();
  const db = database();
  const asset = await db.libraryAsset.create({
    data: {
      path: "/library/missing.mkv",
      sizeBytes: 10n,
      checksum: "fixture",
      owned: true,
      state: "published",
      properties: {},
      coverage: { create: { mediaId: f.media.id, current: true } },
    },
  });
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/library/sections"))
      return Response.json({
        MediaContainer: {
          size: 2,
          Directory: [
            { key: "1", type: "movie", title: "Movies" },
            { key: "2", type: "show", title: "TV" },
          ],
        },
      });
    return Response.json({
      MediaContainer: {
        size: 1,
        totalSize: 1,
        Metadata: [
          {
            ratingKey: url.pathname.includes("/1/") ? "movie" : "episode",
            type: "movie",
            title: "Foreign",
            Media: [{ Part: [{ id: 1, file: "/library/foreign.mkv" }] }],
          },
        ],
      },
    });
  });
  const scanId = crypto.randomUUID();
  const firstPage = await sweepInventory(ctx, scanId);
  expect(firstPage.nextCursor).not.toBeNull();
  expect(
    await db.applicationEvent.count({
      where: { mediaId: f.media.id, kind: "inventory_path_unobserved" },
    }),
  ).toBe(0);
  await sweepInventory(ctx, scanId);
  await sweepInventory(ctx, scanId);
  expect(await db.plexInventoryObservation.count({ where: { scanId } })).toBe(
    2,
  );
  expect(
    await db.libraryAsset.findUnique({
      where: { path: "/library/foreign.mkv" },
    }),
  ).toBeNull();
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ).toMatchObject({ state: "published" });
  expect(
    await db.applicationEvent.count({
      where: { mediaId: f.media.id, kind: "inventory_path_unobserved" },
    }),
  ).toBe(1);
  expect(await sweepInventory(ctx, scanId)).toEqual({
    processed: 0,
    nextCursor: null,
  });
});

test("feed sweep records unsupported capability and never disguises title searches as a feed", async () => {
  await fixture();
  const ctx = context();
  await sweepFeeds(ctx, null);
  expect(
    await database().mediaProvider.findUniqueOrThrow({
      where: { id: "knaben" },
    }),
  ).toMatchObject({
    feedState: "unsupported_recent_feed",
    lastFeedAt: expect.any(Date),
  });
});
