import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import { readMovieRequestFulfillment } from "#infrastructure/movie-editions/fulfillment.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { queueLifecycleNotifications } from "#automation/notifications/events.ts";
import { createNotificationActivities } from "#automation/notifications.ts";

const h = automationTestHarness();
let f: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let continuationId: string;
beforeAll(async () => {
  const db = h.database();
  f = await nativeCompensationFixture(db, h.cipher, {
    fileFactory: async () => {
      const files = await mappedPublicationFixture(db);
      return {
        ...files,
        published: async () => {
          const published = await files.published();
          // Synthetic previously verified original; compensation must still withhold fresh readiness.
          await db.$transaction((tx) =>
            recordVerifiedPublication(tx, [published.entry.assetId], 0),
          );
          return published;
        },
      };
    },
  });
  await f.prepare();
  const input = await f.apply();
  continuationId = input.continuationId;
  await f.observe(input);
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "compensated",
    reason: null,
  });
}, 60_000);
afterAll(async () => {
  if (f !== undefined)
    await rm(f.file.directory, { recursive: true, force: true });
});

test("an actual completed compensation with its active fence cannot fulfill or send readiness despite a prior Plex stamp and fresh choice", async () => {
  const db = h.database();
  const access = { serverMachineId: "server", movieSectionId: "1" };
  await grantTestRequesterAccess(db, f.file.user.id, access.serverMachineId);
  const chosen = await chooseTestMovieEdition(db, {
    actor: { ...f.file.user, role: "member" },
    mediaId: f.file.media.id,
    access,
  });
  const choice = await readMovieChoice(db, {
    requestId: chosen.result.requestId,
    access,
  });
  expect(choice.status).toBe("authorized");
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.published.entry.assetId },
  });
  expect(asset.plexPublishedAt).not.toBeNull();
  expect(
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: continuationId },
    }),
  ).toMatchObject({
    state: "compensated",
    fenceRelease: null,
    verifiedPublication: null,
  });
  expect(
    await readMovieRequestFulfillment(db, {
      requestId: chosen.result.requestId,
      currentAsset: { assetId: asset.id, assetVersion: asset.version },
      access,
    }),
  ).toEqual({
    status: "pending_asset",
    reason: "movie_edition_asset_unavailable",
  });
  await db.mediaUser.update({
    where: { id: f.file.user.id },
    data: {
      email: "fenced@example.com",
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.file.media.id, edition: "default" },
    },
  });
  await db.$transaction((tx) =>
    queueLifecycleNotifications(tx, {
      key: `fenced-choice:${continuationId}`,
      kind: "media_available",
      epoch: asset.ownershipEpoch,
      items: [
        {
          mediaId: f.file.media.id,
          generation: target.generation,
          assetId: asset.id,
          assetVersion: asset.version,
          assetChecksum: asset.checksum ?? "",
        },
      ],
    }),
  );
  const delivery = await db.notificationDelivery.findFirstOrThrow({
    where: { userId: f.file.user.id, event: { kind: "media_available" } },
  });
  const delivered = await createNotificationActivities({
    ...h.context(),
    serverMachineId: access.serverMachineId,
  }).deliverMediaNotification({
    operationId: crypto.randomUUID(),
    notificationId: delivery.id,
  });
  expect(delivered.status).toBe("failed");
  expect(
    await db.notificationDeliveryAttempt.count({
      where: { deliveryId: delivery.id },
    }),
  ).toBe(0);
});
