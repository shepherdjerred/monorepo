import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { reconcileCompensationHousehold } from "#automation/native-compensation/fixtures/household.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let continuationId: string;
let seriesId: string;
let requestId: string;
let operationId: string;
let cursor: string | null = null;
let nextPage = 0;
let directory: string | undefined;
let firstShared: string;
let lastShared: string;
let rootRequesterId: string;

beforeAll(async () => {
  const db = harness.database();
  fixture = await nativeCompensationFixture(db, harness.context().cipher, {
    stopAt: "sidecar_link",
    fileFactory: () => sharedTvFileFixture(db, mappedPublicationFixture),
  });
  directory = fixture.file.directory;
  await fixture.prepare();
  const inverse = await fixture.apply();
  continuationId = inverse.continuationId;
  await fixture.observe(inverse);
  expect(
    await fixture.activities.compensateNativePublicationFiles(inverse),
  ).toEqual({ status: "compensated", reason: null });
  const ids = fixture.published.entry.mediaIds.toSorted();
  firstShared = z.uuid().parse(ids[0]);
  lastShared = z.uuid().parse(ids[1]);
  seriesId = z.uuid().parse(fixture.file.media.parentId);
  await reconcileCompensationHousehold(db, {
    owner: fixture.prior.actor,
    requester: fixture.file.user,
    mediaIds: ids,
    negativeMediaIds: ids,
    kind: "episode",
    serverMachineId: "server",
  });
  const before = Array.from(
    { length: 24 },
    (_, index) =>
      `00000001-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const after = Array.from(
    { length: 975 },
    (_, index) =>
      `fffffffe-ffff-4fff-8fff-${String(index + 1).padStart(12, "0")}`,
  );
  expect(before.every((id) => id < firstShared)).toBe(true);
  expect(after.every((id) => id > lastShared)).toBe(true);
  await db.mediaItem.createMany({
    data: [...before, ...after].map((id, index) => ({
      id,
      kind: "episode",
      parentId: seriesId,
      title: `Catalog episode ${String(index + 3)}`,
      seasonNumber: 1,
      episodeNumber: index + 3,
    })),
  });
  await db.qualityProfileDefault.upsert({
    where: { kind: "series" },
    create: { kind: "series", profileId: fixture.file.profile.id },
    update: { profileId: fixture.file.profile.id },
  });
  const requester = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "New root requester",
    },
  });
  rootRequesterId = requester.id;
  await grantTestRequesterAccess(db, requester.id, "server");
  const requested = await new PrismaMediaCommands(db, {
    keepDays: 30,
    serverMachineId: "server",
  }).createRequest(requester, crypto.randomUUID(), {
    mediaId: seriesId,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  requestId = z.uuid().parse(requested.requestId);
  operationId = z.uuid().parse(requested.operationId);
  expect(
    await db.requestCoverage.count({ where: { rootRequestId: requestId } }),
  ).toBe(0);
  expect(
    await db.mediaItem.count({
      where: { parentId: seriesId, kind: "episode" },
    }),
  ).toBe(1001);
}, 60_000);

afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

describe(
  "bounded root projection across a held shared video",
  { concurrent: false, shuffle: false },
  () => {
    test.each(Array.from({ length: 41 }, (_, index) => index))(
      "actual coverage page %i keeps complete group authority",
      async (page) => {
        expect(nextPage).toBe(page);
        const db = harness.database();
        const input = { requestId, operationId, requestVersion: 0, cursor };
        const activities = createCoverageActivities({ db });
        const result = await activities.expandMediaRequest(input);
        expect(result.processed).toBe(page === 40 ? 1 : 25);
        const row =
          await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
            where: { id: continuationId },
          });
        expect(row.fenceRelease).toBeNull();
        if (page === 0) {
          expect(result.nextCursor).toBe(firstShared);
          expect(row.publicationCoordinatorOperationId).toBeNull();
          expect(
            await db.requestCoverage.count({
              where: { rootRequestId: requestId, mediaId: lastShared },
            }),
          ).toBe(0);
          expect(await activities.expandMediaRequest(input)).toEqual(result);
          const replayed =
            await db.nativePublicationCompensationContinuation.findUniqueOrThrow(
              { where: { id: continuationId } },
            );
          expect(replayed.publicationCoordinatorOperationId).toBeNull();
        } else {
          const coordinator = z
            .uuid()
            .parse(row.publicationCoordinatorOperationId);
          const operation = await db.operation.findUniqueOrThrow({
            where: { id: coordinator },
          });
          expect(operation.kind).toBe("publish_compensated_media");
          const command = z
            .object({ generations: z.record(z.string(), z.int()) })
            .parse(operation.payload);
          expect(row.mediaIds.toSorted()).toEqual([firstShared, lastShared]);
          expect(Object.keys(command.generations).toSorted()).toEqual([
            firstShared,
            lastShared,
          ]);
        }
        if (page === 40) {
          expect(result.nextCursor).toBeNull();
          expect(
            await db.requestCoverage.count({
              where: { rootRequestId: requestId, active: true },
            }),
          ).toBe(1001);
          expect(
            await db.mediaRequest.count({
              where: {
                userId: rootRequesterId,
                media: { parentId: seriesId },
                ...effectiveRequestWhere,
              },
            }),
          ).toBe(1001);
          expect(
            await db.operation.count({
              where: {
                kind: "publish_compensated_media",
                targetId: continuationId,
              },
            }),
          ).toBe(1);
          expect(
            await db.mediaRequest.count({
              where: {
                userId: { in: [fixture.prior.actor.id, fixture.file.user.id] },
                mediaId: { in: [firstShared, lastShared] },
                excluded: true,
                active: false,
              },
            }),
          ).toBe(4);
        }
        cursor = result.nextCursor;
        nextPage++;
      },
    );
  },
);
