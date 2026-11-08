import { afterEach, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { prepareBoundRetention } from "./lifecycle.test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof prepareBoundRetention>> | undefined;
let directory: string | undefined;
beforeEach(async () => {
  const files = await sharedTvFileFixture(
    harness.database(),
    mappedPublicationFixture,
  );
  directory = files.directory;
  fixture = await prepareBoundRetention(
    files,
    await preparePhysicalPublication(files),
    harness.context(),
  );
}, 60_000);
afterEach(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
  fixture = undefined;
});

test("one actual shared-TV file requires both warning projections and restores the whole group once after one leaf becomes unwatched", async () => {
  if (fixture === undefined)
    throw new Error("Shared retention fixture missing");
  const f = fixture;
  const db = harness.database();
  const ids = [...f.published.entry.mediaIds].sort();
  expect(ids).toHaveLength(2);
  expect(
    new Set(
      [...f.items.values()].flatMap(
        (item) =>
          item.Media?.flatMap((media) => media.Part.map((part) => part.id)) ??
          [],
      ),
    ).size,
  ).toBe(1);
  expect(f.history).toHaveLength(2);
  for (const history of f.history) {
    expect(history.value.events).toHaveLength(1);
    expect(history.value.deliveries).toHaveLength(1);
    expect(history.value.attempts).toHaveLength(1);
  }
  expect(await f.quarantine()).toEqual({ status: "quarantined" });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ state: "quarantined" });
  expect(
    await db.mediaItem.findMany({
      where: { id: { in: ids } },
      select: { availability: true },
    }),
  ).toEqual([{ availability: "quarantined" }, { availability: "quarantined" }]);
  const leaf = z.uuid().parse(ids[0]);
  f.state.watched = null;
  expect(await observeRequesterWatch(f.context, leaf)).toEqual({
    complete: false,
    reason: "requester_watch_unknown",
  });
  f.state.watched = false;
  expect(await observeRequesterWatch(f.context, leaf)).toEqual({
    complete: true,
    reason: null,
  });
  const operations = await db.operation.findMany({
    where: { kind: "restore_media", targetId: { in: ids } },
  });
  expect(operations).toHaveLength(1);
  const operation = operations[0];
  if (operation === undefined)
    throw new Error("Shared false observation omitted routed restore");
  const generations = await db.mediaIntent.findMany({
    where: { mediaId: { in: ids }, edition: "default" },
    orderBy: { mediaId: "asc" },
  });
  expect(await observeRequesterWatch(f.context, leaf)).toEqual({
    complete: true,
    reason: null,
  });
  expect(
    await db.operation.findMany({
      where: { kind: "restore_media", targetId: { in: ids } },
    }),
  ).toEqual(operations);
  expect(
    await db.mediaIntent.findMany({
      where: { mediaId: { in: ids }, edition: "default" },
      orderBy: { mediaId: "asc" },
    }),
  ).toEqual(generations);
  const input = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(operation.payload);
  expect(
    await createMediaFileActivities(f.files.context).restoreMediaFiles(input),
  ).toEqual({ status: "restored" });
  expect(
    await createPublicationActivities(f.context).publishRestoredMedia(input),
  ).toEqual({ status: "available", reason: null });
  const access = await f.context.plexAccess("show");
  const bindings = await readCurrentPlexBindings(
    db,
    ids.map((mediaId) => ({
      scope: { mediaId, edition: "default" },
      assetId: f.asset.id,
      access,
    })),
  );
  expect(bindings).toHaveLength(2);
  expect(bindings.every((binding) => binding.status === "current")).toBe(true);
});
