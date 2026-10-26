import { afterEach, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { plexRestoreReceiptHash } from "#infrastructure/plex-binding/restoration.ts";
import { restoredPublicationFixture } from "./restore.test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof restoredPublicationFixture>> | undefined;
beforeEach(async () => {
  fixture = await restoredPublicationFixture(
    harness.database(),
    harness.context(),
  );
}, 60_000);
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.directory, { recursive: true, force: true });
  fixture = undefined;
});
function current() {
  if (fixture === undefined)
    throw new Error("Actual restore fixture not initialized");
  return fixture;
}

test("actual ordinary restoration publishes with its own legacy scan sibling while the raw restore receipt stays literal", async () => {
  const f = current();
  const db = harness.database();
  const hash = plexRestoreReceiptHash(f.operation.result);
  expect(
    await createPublicationActivities(f.context).publishRestoredMedia(f.input),
  ).toEqual({ status: "available", reason: null });
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: f.operation.id },
  });
  expect(operation.result).toMatchObject({
    restoreReceipt: f.receipt,
    plexScan: { sectionId: "1", scope: "publication", offset: 0 },
  });
  expect(plexRestoreReceiptHash(operation.result)).toBe(hash);
  const restoredAsset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  expect(restoredAsset.plexPublishedAt).toEqual(f.asset.plexPublishedAt);
  const reads = await db.$transaction((tx) =>
    readCurrentPlexBindings(tx, [
      {
        scope: { mediaId: f.media.id, edition: "default" },
        assetId: f.asset.id,
        access: {
          serverMachineId: "fixture-server",
          sectionType: "movie",
          sectionId: "1",
        },
      },
    ]),
  );
  expect(reads).toHaveLength(1);
  expect(reads[0]?.status).toBe("current");
});

test("changed raw restoration receipt during scanning cannot be adopted by recapturing the expected parent", async () => {
  const f = current();
  const db = harness.database();
  let reached = false;
  f.hooks.beforeMetadata = async () => {
    delete f.hooks.beforeMetadata;
    reached = true;
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: f.operation.id },
    });
    const result = z.record(z.string(), z.json()).parse(operation.result);
    const receipt = z
      .record(z.string(), z.json())
      .parse(result["restoreReceipt"]);
    await db.operation.update({
      where: { id: operation.id },
      data: {
        result: {
          ...result,
          restoreReceipt: { ...receipt, syntheticUnexpectedField: true },
        },
      },
    });
  };
  expect(
    await createPublicationActivities(f.context).publishRestoredMedia(f.input),
  ).toEqual({ status: "blocked", reason: "scope_changed" });
  expect(reached).toBe(true);
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
  ).toEqual(f.media);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(
    await db.plexBindingCurrent.findMany({
      where: { mediaId: f.media.id },
      orderBy: { edition: "asc" },
    }),
  ).toEqual(f.bindingPointers);
  expect(
    f.bindingPointers.every((pointer) => pointer.evidenceId === null),
  ).toBe(true);
});

test("an unchanged raw restore receipt and new scan checkpoint cannot hide a changed original target generation", async () => {
  const f = current();
  const db = harness.database();
  let reached = false;
  f.hooks.beforeMetadata = async () => {
    delete f.hooks.beforeMetadata;
    reached = true;
    await db.mediaIntent.update({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      data: { generation: { increment: 1 } },
    });
  };
  expect(
    await createPublicationActivities(f.context).publishRestoredMedia(f.input),
  ).toEqual({ status: "blocked", reason: "scope_changed" });
  expect(reached).toBe(true);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: f.operation.id },
  });
  expect(operation.result).toMatchObject({
    restoreReceipt: f.receipt,
    plexScan: { sectionId: "1" },
  });
  expect(plexRestoreReceiptHash(operation.result)).toBe(
    plexRestoreReceiptHash(f.operation.result),
  );
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
  ).toEqual(f.media);
  expect(
    await db.plexBindingCurrent.findMany({
      where: { mediaId: f.media.id },
      orderBy: { edition: "asc" },
    }),
  ).toEqual(f.bindingPointers);
  expect(
    f.bindingPointers.every((pointer) => pointer.evidenceId === null),
  ).toBe(true);
});
