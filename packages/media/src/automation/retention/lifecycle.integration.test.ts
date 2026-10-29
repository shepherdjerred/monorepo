import { afterEach, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { z } from "zod";
import { boundRetentionFixture } from "./lifecycle.test-fixture.ts";

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

test("actual warning birth and simulated elapsed grace produce a bound quarantine; unknown then false queues one restore and rebinds actual restored bytes", async () => {
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
  expect(await f.observe(false)).toEqual([{ complete: true, reason: null }]);
  const restores = await db.operation.findMany({
    where: { targetId: f.files.media.id, kind: "restore_media" },
  });
  expect(restores).toHaveLength(1);
  const restore = restores[0];
  if (restore === undefined)
    throw new Error("Actual bound false omitted restore command");
  const generation = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
    },
  });
  expect(await f.observe(false)).toEqual([{ complete: true, reason: null }]);
  expect(
    await db.operation.findMany({
      where: { targetId: f.files.media.id, kind: "restore_media" },
    }),
  ).toEqual(restores);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
      },
    }),
  ).toEqual(generation);
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
