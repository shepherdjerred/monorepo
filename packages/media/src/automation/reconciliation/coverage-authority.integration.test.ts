import { expect, test } from "vitest";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestLease } from "#testing/authority.ts";
import { createCoverageActivities } from "./coverage.ts";

const harness = automationTestHarness();
test("observe-mode bootstrap projects metadata without granting or downgrading leaf authority", async () => {
  const f = await setup();
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", ownershipConfirmed: false },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    data: { automationEpoch: -1 },
  });
  const root = await f.db.mediaRequest.update({
    where: { id: f.root.id },
    data: { version: { increment: 1 }, coverageCompletedAt: null },
  });
  const future = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Metadata-only episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  expect(
    await f.activity.expandMediaRequest({
      ...f.input,
      requestVersion: root.version,
    }),
  ).toMatchObject({ processed: 2 });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.user.id,
          mediaId: future.id,
          edition: "default",
        },
      },
    }),
  ).toMatchObject({ active: true, direct: false });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: future.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: -1, monitoring: true });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: 0 });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: root.id } }),
  ).toMatchObject({ coverageCompletedAt: expect.any(Date) });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    data: { automationEpoch: 0 },
  });
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    data: { automationEpoch: 1 },
  });
  expect(
    await f.activity.expandMediaRequest({
      ...f.input,
      requestVersion: root.version,
    }),
  ).toEqual({ processed: 0, nextCursor: null });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    data: { automationEpoch: -1 },
  });
  const renewed = await f.db.mediaRequest.update({
    where: { id: root.id },
    data: { version: { increment: 1 } },
  });
  expect(
    await f.activity.expandMediaRequest({
      ...f.input,
      requestVersion: renewed.version,
    }),
  ).toMatchObject({ processed: 2 });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: 1 });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: future.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: -1 });
});

async function setup() {
  const base = await harness.fixture();
  const db = harness.database();
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Restored series",
    },
  });
  await createTestDefaultTarget(db, series.id, { automationEpoch: 0 });
  const root = await db.mediaRequest.create({
    data: {
      userId: base.user.id,
      mediaId: series.id,
      includeFutureEpisodes: true,
    },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Selected episode",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  const activity = createCoverageActivities({ db });
  const input = {
    requestId: root.id,
    requestVersion: root.version,
    operationId: crypto.randomUUID(),
    cursor: null,
  };
  await activity.expandMediaRequest(input);
  return { db, series, root, episode, activity, input, user: base.user };
}

test("catalog expansion cannot renew an old root or its leaves after runtime recovery", async () => {
  const f = await setup();
  const before = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
  });
  await grantTestLease(f.db, 1);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  const future = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Future episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  expect(await f.activity.expandMediaRequest(f.input)).toEqual({
    processed: 0,
    nextCursor: null,
  });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toEqual(before);
  expect(
    await f.db.mediaIntent.findUnique({
      where: { mediaId_edition: { mediaId: future.id, edition: "default" } },
    }),
  ).toBeNull();
  expect(await f.db.mediaRequest.count({ where: { mediaId: future.id } })).toBe(
    0,
  );
});

test("negative leaf declarations survive fresh root versions and future episodes without epoch renewal", async () => {
  const f = await setup();
  await f.db.mediaRequest.update({
    where: {
      userId_mediaId_edition: {
        userId: f.user.id,
        mediaId: f.episode.id,
        edition: "default",
      },
    },
    data: {
      direct: true,
      excluded: true,
      active: false,
      version: { increment: 1 },
    },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    data: { automationEpoch: -1, monitoring: false },
  });
  const root = await f.db.mediaRequest.update({
    where: { id: f.root.id },
    data: { version: { increment: 1 } },
  });
  const future = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Future episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  await f.activity.expandMediaRequest({
    ...f.input,
    requestVersion: root.version,
  });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.user.id,
          mediaId: f.episode.id,
          edition: "default",
        },
      },
    }),
  ).toMatchObject({ direct: true, excluded: true, active: false });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: -1, monitoring: false });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: future.id, edition: "default" } },
    }),
  ).toMatchObject({
    automationEpoch: 0,
    desiredPresence: true,
    monitoring: true,
  });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: root.id } }),
  ).toMatchObject({
    version: root.version,
    includeFutureEpisodes: true,
    active: true,
  });
});

test("old-root cancellation can remove inherited authority without downgrading a current direct leaf", async () => {
  const f = await setup();
  await grantTestLease(f.db, 1);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    data: { automationEpoch: 1 },
  });
  await f.db.mediaRequest.update({
    where: {
      userId_mediaId_edition: {
        userId: f.user.id,
        mediaId: f.episode.id,
        edition: "default",
      },
    },
    data: { direct: true },
  });
  const cancelled = await f.db.mediaRequest.update({
    where: { id: f.root.id },
    data: {
      active: false,
      excluded: true,
      direct: false,
      version: { increment: 1 },
    },
  });
  await f.activity.expandMediaRequest({
    ...f.input,
    requestVersion: cancelled.version,
  });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: 1, monitoring: true });
  expect(
    await f.db.requestCoverage.findUniqueOrThrow({
      where: {
        rootRequestId_mediaId: {
          rootRequestId: f.root.id,
          mediaId: f.episode.id,
        },
      },
    }),
  ).toMatchObject({ active: false });
});
