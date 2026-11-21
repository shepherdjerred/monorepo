import { afterEach, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { z } from "zod";
import {
  boundRetentionFixture,
  defaultRetentionInterestSnapshot,
} from "./lifecycle.test-fixture.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { continueQuarantinedInterest } from "#infrastructure/request-interest/quarantine-release.test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof boundRetentionFixture>> | undefined;
beforeEach(async () => {
  fixture = await boundRetentionFixture(harness.database(), harness.context());
}, 60_000);
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.files.directory, { recursive: true, force: true });
  fixture = undefined;
});
function current() {
  if (fixture === undefined)
    throw new Error("Actual bound lifecycle fixture not initialized");
  return fixture;
}

test("actual quarantine observes Plex unwatch without restoring; explicit Keep watching restores and rebinds the actual bytes", async () => {
  const f = current(),
    db = harness.database();
  expect(f.retention.decision.state).toBe("grace_period");
  expect(f.retention.decision.graceUntil?.getTime()).toBeLessThan(Date.now());
  expect(f.retention.decision.evidence).toMatchObject({
    activePlayback: false,
  });
  expect(await f.quarantine()).toEqual({ status: "quarantined" });
  const quarantine = await db.operation.findUniqueOrThrow({
    where: { id: f.retention.input.operationId },
  });
  const receipt = z
    .object({ quarantinePlexReceipt: z.json() })
    .parse(quarantine.result).quarantinePlexReceipt;
  expect(
    await db.plexBindingCurrent.count({
      where: { mediaId: f.files.media.id, evidenceId: { not: null } },
    }),
  ).toBe(0);
  expect(await f.observe(null)).toEqual([
    { complete: false, reason: "requester_watch_unknown" },
  ]);
  expect(
    await db.watchState.count({ where: { mediaId: f.files.media.id } }),
  ).toBe(0);
  expect(
    await db.plexWatchProjection.count({
      where: { mediaId: f.files.media.id },
    }),
  ).toBe(0);
  expect(
    await db.operation.count({
      where: { targetId: f.files.media.id, kind: "restore_media" },
    }),
  ).toBe(0);
  const requests = await db.mediaRequest.findMany({
    where: { mediaId: f.files.media.id },
    orderBy: { id: "asc" },
  });
  expect(requests).toEqual([
    expect.objectContaining({
      keepingPolicy: "temporary",
      interestState: "finished",
      interestReleaseReason: "watched",
    }),
  ]);
  const generation = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
    },
  });
  for (let observation = 0; observation < 2; observation++)
    expect(await f.observe(false)).toEqual([{ complete: true, reason: null }]);
  expect(
    await db.operation.findMany({
      where: { targetId: f.files.media.id, kind: "restore_media" },
    }),
  ).toEqual([]);
  expect(
    await db.mediaRequest.findMany({
      where: { mediaId: f.files.media.id },
      orderBy: { id: "asc" },
    }),
  ).toEqual(requests);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
      },
    }),
  ).toEqual(generation);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ state: "quarantined" });
  const renewed = await continueQuarantinedInterest(
    f.context,
    f.files.user,
    f.files.media.id,
  );
  expect(await renewed.replay()).toEqual(renewed.result);
  const restores = await db.operation.findMany({
    where: { targetId: f.files.media.id, kind: "restore_media" },
  });
  expect(restores).toHaveLength(1);
  const restore = restores[0];
  if (restore === undefined)
    throw new Error("Explicit Keep watching omitted its restore command");
  const input = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(restore.payload);
  expect(
    await createMediaFileActivities(f.files.context).restoreMediaFiles(input),
  ).toEqual({ status: "restored" });
  expect(
    await createPublicationActivities(f.context).publishRestoredMedia(input),
  ).toEqual({ status: "available", reason: null });
  const binding = await readCurrentPlexBindings(db, [
    {
      scope: { mediaId: f.files.media.id, edition: "default" },
      assetId: f.asset.id,
      access: await f.context.plexAccess("movie"),
    },
  ]);
  expect(binding[0]?.status).toBe("current");
  const quarantineOperation = await db.operation.findUniqueOrThrow({
    where: { id: quarantine.id },
  });
  expect(quarantineOperation.result).toMatchObject({
    quarantinePlexReceipt: receipt,
  });
});

test("a housemate who never asked for a leaving title holds it for 30 days: the due removal cannot run, and the next one starts from a fresh notice to those who asked", async () => {
  const f = current(),
    db = harness.database();
  const media = f.files.media.id;
  const leaving = f.retention.decision;
  const user = await db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Housemate" },
  });
  await grantTestRequesterAccess(db, user.id, "fixture-server");
  const housemate = { ...user, role: "member" as const };
  const app = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    visibilitySections: { movie: "1", series: "2" },
  });
  const listed = async () => {
    const removals = await app.removals(housemate);
    return removals.map((row) => row.id);
  };
  expect(await listed()).toContain(leaving.id);
  const context = await app.getDefaultCommandContext(housemate, media);
  expect(context).toMatchObject({
    access: "detail",
    ownRequests: [],
    allowedProtectiveActions: ["keep"],
  });
  const before = await defaultRetentionInterestSnapshot(db, [media]);
  await app.executeDefaultCommand(housemate, crypto.randomUUID(), {
    schemaVersion: 2,
    scope: context.scope,
    expected: context.expected,
    command: { action: "keep" },
  });
  expect(
    await db.retentionDecision.findUniqueOrThrow({ where: { id: leaving.id } }),
  ).toMatchObject({ state: "cancelled" });
  expect(await listed()).not.toContain(leaving.id);
  // The removal that was already due can no longer take the files.
  expect(await f.quarantine()).toMatchObject({ status: "protected" });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ state: "published" });
  // The hold is the housemate's. Nobody's request changed and none was made.
  const after = await defaultRetentionInterestSnapshot(db, [media]);
  expect(after.requests).toEqual(before.requests);
  expect(after.requests.map((request) => request.userId)).toEqual([
    f.files.user.id,
  ]);
  expect(
    await db.retentionHold.findMany({ where: { mediaId: media } }),
  ).toMatchObject([{ userId: user.id, isPin: false }]);
  const generation = after.targets[0]?.generation;
  if (generation === undefined) throw new Error("Held target is missing");
  const evaluate = () =>
    createRetentionActivities(f.context).evaluateMediaRetention({
      operationId: crypto.randomUUID(),
      mediaId: media,
      generation,
    });
  expect(await evaluate()).toMatchObject({
    status: "protected",
    reason: "ancestor_keep_hold",
  });
  // The hold lapses on its own date; retention does not wait on its holder.
  // A new removal begins with a new notice, sent to the member who asked for
  // the title and not to the housemate who held it.
  await db.retentionHold.updateMany({
    where: { mediaId: media },
    data: { until: new Date(Date.now() - 1000) },
  });
  const resumed = await evaluate();
  expect(resumed).toMatchObject({ status: "warning" });
  expect(resumed.decisionId).not.toBe(leaving.id);
  const notified = await db.notificationDelivery.findMany({
    where: {
      event: {
        kind: "retention_warning",
        payload: { path: ["decisionId"], equals: resumed.decisionId ?? "" },
      },
    },
    select: { userId: true },
  });
  expect([...new Set(notified.map((delivery) => delivery.userId))]).toEqual([
    f.files.user.id,
  ]);
  // It is leaving again, and the whole household can see that.
  expect(await listed()).toContain(resumed.decisionId);
});

test("a reused Part after quarantine is unknown and cannot authorize an unwatched restore", async () => {
  const f = current(),
    db = harness.database();
  expect(await f.quarantine()).toEqual({ status: "quarantined" });
  const item = f.items.get(f.files.media.id);
  const part = item?.Media?.[0]?.Part[0];
  if (part === undefined) throw new Error("Fixture Part missing");
  part.id++;
  expect(await f.observe(false)).toEqual([
    { complete: false, reason: "requester_watch_unknown" },
  ]);
  expect(
    await db.operation.count({
      where: { targetId: f.files.media.id, kind: "restore_media" },
    }),
  ).toBe(0);
  expect(
    await db.watchState.count({ where: { mediaId: f.files.media.id } }),
  ).toBe(0);
  const quarantinedAsset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  expect(quarantinedAsset.state).toBe("quarantined");
});

test("fresh complete sessions protect canonical and unknown control paths independently of a durable binding", async () => {
  const f = current();
  f.state.sessions = [
    {
      ratingKey: "900000",
      type: "movie",
      title: "Synthetic unknown session",
      Media: [
        {
          Part: [
            {
              id: 900_001,
              file: "/data/movies/.media-control/rollback/unknown",
              size: 1,
            },
          ],
        },
      ],
    },
  ];
  expect(await f.evaluate()).toMatchObject({
    status: "protected",
    reason: "active_playback",
  });
  f.state.sessions = [
    {
      ratingKey: "900002",
      type: "movie",
      title: "Synthetic incomplete session",
    },
  ];
  expect(await f.evaluate()).toMatchObject({
    status: "protected",
    reason: "active_playback",
  });
  f.state.sessions = [];
  expect(await f.refresh()).toMatchObject({
    status: "quarantine",
    decisionId: f.retention.decision.id,
  });
});
