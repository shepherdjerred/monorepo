import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { createCoverageActivities } from "./coverage.ts";

const { database, fixture } = automationTestHarness();

test("a 1001 episode request commits one root, resumes bounded pages, and cancels authority before cleanup", async () => {
  const { user, profile } = await fixture();
  const db = database();
  await db.plexIdentityMapping.update({
    where: { userId: user.id },
    data: {
      userId: user.id,
      serverMachineId: "fixture",
      kind: "account",
      permittedSectionIds: ["2"],
      permittedMediaKinds: ["series"],
      verifiedAt: new Date(),
    },
  });
  await db.qualityProfileDefault.upsert({
    where: { kind: "series" },
    create: { kind: "series", profileId: profile.id },
    update: { profileId: profile.id },
  });
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Long series" },
  });
  await db.mediaItem.createMany({
    data: Array.from({ length: 1001 }, (_, index) => ({
      id: crypto.randomUUID(),
      kind: "episode" as const,
      title: `Episode ${String(index + 1)}`,
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: index + 1,
    })),
  });
  const commands = new PrismaMediaCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture",
  });
  const result = await commands.createRequest(user, crypto.randomUUID(), {
    mediaId: series.id,
    subtitleLanguages: ["en"],
    includeSpecials: false,
  });
  const requestId = result.requestId;
  const operationId = result.operationId;
  if (requestId === undefined || operationId === undefined)
    throw new Error("Missing request identity");
  expect(
    await db.requestCoverage.count({ where: { rootRequestId: requestId } }),
  ).toBe(0);
  expect(
    await db.mediaRequest.count({
      where: { userId: user.id, media: { parentId: series.id } },
    }),
  ).toBe(0);
  const activity = createCoverageActivities({ db });
  const input = { requestId, operationId, requestVersion: 0, cursor: null };
  const first = await activity.expandMediaRequest(input);
  expect(first.processed).toBe(25);
  const before = await db.mediaIntent.findMany({
    where: { media: { parentId: series.id } },
    orderBy: { mediaId: "asc" },
  });
  expect(await activity.expandMediaRequest(input)).toEqual(first);
  expect(
    await db.mediaIntent.findMany({
      where: { media: { parentId: series.id } },
      orderBy: { mediaId: "asc" },
    }),
  ).toEqual(before);
  let cursor = first.nextCursor;
  let pages = 1;
  while (cursor !== null) {
    const page = await activity.expandMediaRequest({ ...input, cursor });
    expect(page.processed).toBeLessThanOrEqual(25);
    cursor = page.nextCursor;
    pages++;
  }
  expect(pages).toBe(41);
  expect(
    await db.mediaRequest.count({
      where: {
        userId: user.id,
        media: { parentId: series.id },
        ...effectiveRequestWhere,
      },
    }),
  ).toBe(1001);
  expect(
    await db.mediaIntent.count({
      where: { media: { parentId: series.id }, profileId: profile.id },
    }),
  ).toBe(1001);
  await commands.cancelRequest(user, crypto.randomUUID(), requestId, 0);
  expect(
    await db.mediaRequest.count({
      where: { userId: user.id, media: { parentId: series.id }, active: true },
    }),
  ).toBe(1001);
  expect(
    await db.mediaRequest.count({
      where: {
        userId: user.id,
        media: { parentId: series.id },
        ...effectiveRequestWhere,
      },
    }),
  ).toBe(0);
  expect(await activity.expandMediaRequest(input)).toEqual({
    processed: 0,
    nextCursor: null,
  });
  cursor = null;
  do {
    const page = await activity.expandMediaRequest({
      ...input,
      requestVersion: 1,
      cursor,
    });
    cursor = page.nextCursor;
  } while (cursor !== null);
  expect(
    await db.mediaIntent.count({
      where: { media: { parentId: series.id }, monitoring: true },
    }),
  ).toBe(0);
}, 90_000);

test("future expansion preserves explicit episode cancellation and overlapping direct claims", async () => {
  const { user } = await fixture();
  const db = database();
  await db.plexIdentityMapping.update({
    where: { userId: user.id },
    data: {
      userId: user.id,
      serverMachineId: "fixture",
      kind: "account",
      permittedSectionIds: ["2"],
      permittedMediaKinds: ["series"],
      verifiedAt: new Date(),
    },
  });
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Ongoing" },
  });
  const commands = new PrismaMediaCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture",
  });
  const root = await commands.createRequest(user, crypto.randomUUID(), {
    mediaId: series.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  if (root.requestId === undefined || root.operationId === undefined)
    throw new Error("Missing request");
  const activity = createCoverageActivities({ db });
  const input = {
    requestId: root.requestId,
    operationId: root.operationId,
    requestVersion: 0,
    cursor: null,
  };
  await activity.expandMediaRequest(input);
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Future",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  await activity.expandMediaRequest(input);
  const inherited = await db.mediaRequest.findUniqueOrThrow({
    where: { userId_mediaId: { userId: user.id, mediaId: episode.id } },
  });
  await commands.cancelRequest(
    user,
    crypto.randomUUID(),
    inherited.id,
    inherited.version,
  );
  await activity.expandMediaRequest(input);
  expect(
    await db.mediaRequest.count({
      where: { mediaId: episode.id, ...effectiveRequestWhere },
    }),
  ).toBe(0);
  await commands.createRequest(user, crypto.randomUUID(), {
    mediaId: episode.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  await commands.cancelRequest(user, crypto.randomUUID(), root.requestId, 0);
  expect(
    await db.mediaRequest.count({
      where: { mediaId: episode.id, ...effectiveRequestWhere },
    }),
  ).toBe(1);
});
