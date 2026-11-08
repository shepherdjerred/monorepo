import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import { PrismaNumberingAdministration } from "#infrastructure/numbering-admin.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const value = await identityFixture(
    harness.database(),
    harness.context(async () => {
      throw new Error("Unexpected external read");
    }),
    true,
    { fileFactory: mappedPublicationFixture },
  );
  directories.push(value.files.directory);
  return value;
}

test("an owner-reviewed absolute file publishes under canonical coordinates and verifies Plex playback identity", async () => {
  const f = await fixture();
  const acquired = await f.acquire();
  const activities = createMediaFileActivities(f.files.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const attempt = await harness
    .database()
    .acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  expect(plan).toHaveLength(1);
  expect(plan[0]).toMatchObject({
    mediaIds: [f.files.media.id],
    identityEvidence: {
      sourceFile: {
        torrentFileIndex: 0,
        relativePath: "Example Show - 123.mkv",
        sizeBytes: "20",
      },
      parsedCoordinates: {
        forms: [{ kind: "absolute", episodes: [123], form: "single" }],
        invalid: false,
      },
      coverage: [f.files.media.id],
    },
  });
  expect(plan[0]?.libraryPath).toContain("Season 01/Example Show - S01E01");
  expect(f.adds()).toBe(1);
  const { context: network } = await retentionPlexContext(
    harness.database(),
    harness.context(),
    attempt.mediaIds,
  );
  const publication = createPublicationActivities(network);
  expect(await publication.publishMediaToPlex(acquired.input)).toEqual({
    status: "available",
    reason: null,
  });
  await publication.finalizeMediaAcquisition(acquired.input);
  const published = await harness
    .database()
    .mediaItem.findUniqueOrThrow({ where: { id: f.files.media.id } });
  expect(published.availability).toBe("available");
});

test("changing an unselected sibling mapping during hashing invalidates the selected file proof", async () => {
  const f = await fixture();
  const sibling = await harness.database().mediaItem.create({
    data: {
      kind: "episode",
      title: "Second episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
      externalIds: {
        absoluteNumber: 124,
        numberingEvidence: "Previously reviewed second episode",
      },
    },
  });
  const acquired = await f.acquire();
  let changed = false;
  f.files.context.checkpoint = async (phase) => {
    if (phase !== "hashing" || changed) return;
    changed = true;
    await new PrismaNumberingAdministration(harness.database()).save(
      f.actor,
      crypto.randomUUID(),
      sibling.id,
      {
        expectedVersion: sibling.version,
        absoluteNumber: 125,
        evidence: "Owner corrected the unselected episode mapping",
      },
    );
  };
  expect(
    await createMediaFileActivities(f.files.context).inspectAndStageMedia(
      acquired.input,
    ),
  ).toEqual({ status: "blocked", reason: "identity_mapping_changed" });
  expect(changed).toBe(true);
  expect(
    await harness.database().libraryAsset.count({
      where: { coverage: { some: { mediaId: f.files.media.id } } },
    }),
  ).toBe(0);
  const attempt = await harness
    .database()
    .acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
  expect(attempt.filePlan).toBeNull();
});

test("torrent file index and name cannot drift after staging", async () => {
  const f = await fixture();
  const acquired = await f.acquire();
  const activities = createMediaFileActivities(f.files.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const torrentId = z.string().parse(acquired.attempt.torrentId);
  await harness.database().torrent.update({
    where: { id: torrentId },
    data: {
      observation: {
        torrent: {
          progress: 1,
          save_path: storedFilePath(f.files.context, "tv", "downloads", ""),
        },
        files: [
          {
            index: 0,
            name: "Different Show - 123.mkv",
            size: 20,
            progress: 1,
          },
        ],
      },
    },
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "blocked",
    reason: "file_identity_changed",
  });
  expect(
    await harness.database().libraryAsset.count({
      where: { coverage: { some: { mediaId: f.files.media.id } } },
    }),
  ).toBe(0);
});

test("revoked owner authority after staging protects the file effect", async () => {
  const f = await fixture();
  const acquired = await f.acquire();
  const activities = createMediaFileActivities(f.files.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  await harness.database().mediaUser.update({
    where: { id: f.actor.id },
    data: { restricted: true, version: { increment: 1 } },
  });
  const result = await activities.promoteMediaFiles(acquired.input);
  expect(result.status).toBe("blocked");
  expect(
    await harness.database().libraryAsset.count({
      where: { coverage: { some: { mediaId: f.files.media.id } } },
    }),
  ).toBe(0);
});
