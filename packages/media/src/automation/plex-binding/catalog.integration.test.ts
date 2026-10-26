import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sweepInventory } from "#automation/reconciliation/inventory.ts";
import { fullSeriesNumberingDigest } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { createPlexBindingActivities } from "./activities.ts";
import { bindingTestExecution } from "./test-fixture.ts";
import { tvBindingContext } from "./tv.test-fixture.ts";

const harness = automationTestHarness();
let directory: string | undefined;
let prepared: Awaited<ReturnType<typeof prepare>>;
beforeAll(async () => {
  prepared = await prepare();
}, 60_000);
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

async function prepare() {
  const db = harness.database();
  const file = await sharedTvFileFixture(db, mappedPublicationFixture);
  directory = file.directory;
  const seriesId = file.media.parentId;
  if (seriesId === null) throw new Error("TV fixture omitted series");
  await db.mediaItem.createMany({
    data: Array.from({ length: 999 }, (_, index) => ({
      kind: "episode",
      parentId: seriesId,
      title: `Catalog episode ${String(index + 3)}`,
      seasonNumber: 1,
      episodeNumber: index + 3,
    })),
  });
  const published = await file.published();
  const tv = await tvBindingContext(
    db,
    harness.context(),
    published.entry.mediaIds,
  );
  const scanId = crypto.randomUUID();
  await db.reconciliationScan.create({
    data: {
      id: scanId,
      kind: "inventory",
      progress: { section: 2, offset: 0 },
    },
  });
  const item = tv.items.find((value) => value.index === 1);
  if (item === undefined)
    throw new Error("Selected TV fixture metadata missing");
  await db.plexInventoryObservation.create({
    data: {
      sectionId: "2",
      ratingKey: item.ratingKey,
      path: tv.rows[0]?.asset.path ?? "",
      kind: "episode",
      guids: [],
      seasonNumber: 1,
      episodeNumber: 1,
      scanId,
      observedAt: new Date(),
    },
  });
  return { file, published, tv, scanId };
}

test("phase2 queues before observed-path continue and binds the real shared file in a complete 1001-episode catalog", async () => {
  const db = harness.database();
  const { file, published, tv, scanId } = prepared;
  expect(tv.catalog).toHaveLength(1001);
  expect(published.entry.mediaIds).toHaveLength(2);
  const original = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: published.attempt.id },
  });
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: published.entry.assetId },
  });
  expect(await sweepInventory(tv.context, scanId)).toEqual({
    processed: 1,
    nextCursor: "cleanup",
  });
  const request = await db.plexBindingVerificationRequest.findFirstOrThrow({
    where: { assetIds: { has: asset.id } },
  });
  const expected = PlexBindingExpectedSchema.parse(request.expected);
  expect(expected.newGroups).toHaveLength(1);
  expect(expected.targets).toHaveLength(2);
  const digest = fullSeriesNumberingDigest(
    tv.series,
    [...tv.catalog].sort((a, b) => a.id.localeCompare(b.id)),
  );
  expect(
    expected.targets.every((target) => target.numberingHash === digest),
  ).toBe(true);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: request.operationId },
  });
  expect(
    await createPlexBindingActivities(tv.context).reverify(
      ReverifyPlexBindingInputSchema.parse(operation.payload),
      bindingTestExecution(),
    ),
  ).toEqual({ status: "verified", bindingCount: 2 });
  expect(tv.pages.filter((offset) => offset === 1000)).toHaveLength(2);
  const bindings = await db.$transaction((tx) =>
    readCurrentPlexBindings(
      tx,
      published.entry.mediaIds.map((mediaId) => ({
        scope: { mediaId, edition: "default" },
        assetId: asset.id,
        access: {
          serverMachineId: "fixture-server",
          sectionId: "2",
          sectionType: "show",
        },
      })),
    ),
  );
  expect(bindings.every((binding) => binding.status === "current")).toBe(true);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: original.id },
    }),
  ).toEqual(original);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ).toEqual(asset);
  expect(
    await db.plexBindingCurrent.count({
      where: { mediaId: { in: published.entry.mediaIds } },
    }),
  ).toBe(2);
  const scan = await db.reconciliationScan.findUniqueOrThrow({
    where: { id: scanId },
  });
  expect(scan.progress).toEqual({ section: 3, offset: 0, assetCursor: null });
  expect(file.media.kind).toBe("episode");
});
