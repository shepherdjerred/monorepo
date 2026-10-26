import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
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
  const acquired = await file.acquisition();
  const birth = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const leaves = await db.mediaItem.findMany({
    where: { id: { in: birth.mediaIds } },
  });
  expect(leaves).toHaveLength(2);
  for (const leaf of leaves)
    expect(leaf.externalIds).not.toHaveProperty("seriesTmdb");
  const physical = createMediaFileActivities(file.context);
  expect(await physical.inspectAndStageMedia(acquired.input)).toMatchObject({
    status: "staged",
  });
  expect(await physical.promoteMediaFiles(acquired.input)).toMatchObject({
    status: "published",
  });
  const original = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: birth.id },
  });
  expect(original.identityEvidence).toEqual(birth.identityEvidence);
  const tv = await tvBindingContext(db, harness.context(), birth.mediaIds);
  return { file, acquired, original, tv };
}

describe(
  "actual shared TV publication uses original canonical root authority",
  { concurrent: false, shuffle: false },
  () => {
    test("a contradictory server show GUID cannot publish the otherwise exact shared path", async () => {
      const { tv, acquired, original } = prepared;
      const guids = tv.show.Guid;
      tv.show.Guid = [{ id: `tmdb://${String(Number(tv.series.tmdbId) + 1)}` }];
      try {
        expect(
          await createPublicationActivities(tv.context).publishMediaToPlex(
            acquired.input,
          ),
        ).toEqual({ status: "blocked", reason: "metadata_changed" });
      } finally {
        if (guids === undefined) delete tv.show.Guid;
        else tv.show.Guid = guids;
      }
      const db = harness.database();
      expect(
        await db.plexBindingCurrent.count({
          where: { mediaId: { in: original.mediaIds } },
        }),
      ).toBe(0);
      expect(
        await db.mediaItem.count({
          where: { id: { in: original.mediaIds }, availability: "available" },
        }),
      ).toBe(0);
      expect(
        await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: original.id },
        }),
      ).toEqual(original);
    });

    test("valid root GUID and full TV hierarchy publish both leaves without duplicate leaf seriesTmdb", async () => {
      const { tv, acquired, original } = prepared;
      const db = harness.database();
      expect(
        await createPublicationActivities(tv.context).publishMediaToPlex(
          acquired.input,
        ),
      ).toEqual({ status: "available", reason: null });
      const access = await tv.context.plexAccess("show");
      const reads = await db.$transaction((tx) =>
        readCurrentPlexBindings(
          tx,
          tv.rows.map((row) => ({
            scope: { mediaId: row.mediaId, edition: "default" },
            assetId: row.assetId,
            access,
          })),
        ),
      );
      expect(reads).toHaveLength(2);
      expect(reads.every((row) => row.status === "current")).toBe(true);
      expect(
        await db.mediaItem.count({
          where: { id: { in: original.mediaIds }, availability: "available" },
        }),
      ).toBe(2);
      expect(
        await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: original.id },
        }),
      ).toEqual(original);
      for (const leaf of await db.mediaItem.findMany({
        where: { id: { in: original.mediaIds } },
      }))
        expect(leaf.externalIds).not.toHaveProperty("seriesTmdb");
    });
  },
);
