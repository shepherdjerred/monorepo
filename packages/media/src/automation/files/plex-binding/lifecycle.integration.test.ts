import { afterAll, expect, test } from "vitest";
import { access, readFile, rm } from "node:fs/promises";
import nodePath from "node:path";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { boundRetentionFixture } from "#automation/retention/lifecycle.test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { elapsedQuarantineClient } from "./elapsed-quarantine.test-support.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const value = await boundRetentionFixture(
    harness.database(),
    harness.context(),
  );
  directories.push(value.files.directory);
  return value;
}

test("restore recovers a quarantine filesystem effect whose database commit was interrupted", async () => {
  const bound = await fixture();
  const f = bound.files;
  const original = bound.published;
  const retention = bound.retention;
  const activities = createMediaFileActivities(f.context);
  f.context.checkpoint = (phase) =>
    phase === "move-unlinked"
      ? Promise.reject(new Error("quarantine interrupted"))
      : Promise.resolve();
  await expect(
    activities.quarantineMediaFiles(retention.input),
  ).rejects.toThrow("quarantine interrupted");
  const intent = await harness.database().mediaIntent.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { generation: { increment: 1 } },
  });
  await harness.database().retentionDecision.update({
    where: { id: retention.decision.id },
    data: { state: "cancelled" },
  });
  const operation = await harness.database().operation.create({
    data: {
      kind: "restore_media",
      payload: { mediaId: f.media.id, generation: intent.generation },
    },
  });
  f.context.checkpoint = () => Promise.resolve();
  expect(
    await activities.restoreMediaFiles({
      mediaId: f.media.id,
      operationId: operation.id,
    }),
  ).toEqual({ status: "restored" });
  expect(
    await readFile(
      nodePath.join(f.roots.library, original.entry.libraryPath),
      "utf8",
    ),
  ).toBe(original.content);
});

test("quarantine and restore preserve exact content and invalidated deletion stays protected", async () => {
  const bound = await fixture();
  const f = bound.files;
  const original = bound.published;
  const retention = bound.retention;
  const activities = createMediaFileActivities(f.context);
  expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
    status: "quarantined",
  });
  await expect(
    access(nodePath.join(f.roots.library, original.entry.libraryPath)),
  ).rejects.toThrow();
  const intent = await harness.database().mediaIntent.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { generation: { increment: 1 } },
  });
  const operation = await harness.database().operation.create({
    data: {
      kind: "restore_media",
      payload: { mediaId: f.media.id, generation: intent.generation },
    },
  });
  expect(
    await activities.restoreMediaFiles({
      mediaId: f.media.id,
      operationId: operation.id,
    }),
  ).toEqual({ status: "restored" });
  expect(
    await activities.restoreMediaFiles({
      mediaId: f.media.id,
      operationId: operation.id,
    }),
  ).toEqual({ status: "restored" });
  expect(
    await readFile(
      nodePath.join(f.roots.library, original.entry.libraryPath),
      "utf8",
    ),
  ).toBe(original.content);
  expect(
    await activities.purgeMediaFiles({
      ...retention.input,
      operationId: crypto.randomUUID(),
    }),
  ).toMatchObject({ status: "protected" });
});

test("stale playback evidence protects a fully watched and notified asset", async () => {
  const bound = await fixture();
  const f = bound.files;
  const retention = bound.retention;
  f.advance(61_000);
  expect(
    await createMediaFileActivities(f.context).quarantineMediaFiles(
      retention.input,
    ),
  ).toEqual({ status: "protected", reason: "evidence_stale" });
});

test("the same retention operation quarantines then purges only after seven days and fresh watch evidence", async () => {
  const fresh = await fixture();
  expect(await fresh.quarantine()).toEqual({ status: "quarantined" });
  expect(
    await createMediaFileActivities(fresh.files.context).purgeMediaFiles(
      fresh.retention.input,
    ),
  ).toEqual({ status: "protected", reason: "retention_not_due" });

  const bound = await fixture();
  const f = bound.files;
  const db = harness.database();
  const timing = await elapsedQuarantineClient(db, {
    ...bound.retention.input,
    mediaIds: [f.media.id],
  });
  f.context.db = timing.db;
  try {
    expect(await bound.quarantine()).toEqual({ status: "quarantined" });
  } finally {
    f.context.db = db;
  }
  const birth = await timing.assertCommitted();
  await bound.observe(true);
  expect(await bound.refresh()).toMatchObject({ status: "purge" });
  const input = bound.retention.input;
  const activities = createMediaFileActivities(f.context);
  // Negative-only row faults cannot manufacture bound watch or notification authority.
  await db.watchState.update({
    where: {
      userId_mediaId_edition: {
        edition: "default",
        userId: f.user.id,
        mediaId: f.media.id,
      },
    },
    data: { observedAt: new Date(Date.now() - 16 * 60_000) },
  });
  expect(await activities.purgeMediaFiles(input)).toEqual({
    status: "protected",
    reason: "watch_unconfirmed",
  });
  await bound.observe(true);
  await db.notificationDelivery.updateMany({
    where: { event: { mediaId: f.media.id }, userId: f.user.id },
    data: { reconciledAt: new Date(Date.now() - 61_000) },
  });
  expect(await activities.purgeMediaFiles(input)).toMatchObject({
    status: "protected",
    reason: "warning_unconfirmed",
  });
  // Only a real fresh Network evaluation may reconcile delivery and issue a new bounded proof.
  expect(await bound.refresh()).toMatchObject({ status: "purge" });
  expect(await activities.purgeMediaFiles(bound.retention.input)).toEqual({
    status: "purged",
  });
  expect(await activities.purgeMediaFiles(bound.retention.input)).toEqual({
    status: "purged",
  });
  expect(
    await db.libraryAsset.findUniqueOrThrow({
      where: { id: bound.published.entry.assetId },
    }),
  ).toMatchObject({ state: "purged" });
  expect(await timing.assertCommitted()).toEqual(birth);
});

test("a missing accepted warning and a changed runtime epoch each protect files", async () => {
  const bound = await fixture();
  const f = bound.files;
  const retention = bound.retention;
  const activities = createMediaFileActivities(f.context);
  await harness.database().notificationDelivery.updateMany({
    where: { userId: f.user.id },
    data: { state: "unknown", acceptedAt: null },
  });
  expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
    status: "protected",
    reason: "warning_unconfirmed",
  });
  await harness.database().mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
    status: "protected",
    reason: "runtime_protected",
  });
});
