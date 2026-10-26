import { rm } from "node:fs/promises";
import { afterAll, expect, test } from "vitest";
import { createPublicationActivities } from "./publication.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "./publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "./native-archive/fixtures/shared-tv.ts";
import { preparePhysicalPublication } from "./plex-binding/test-fixture.ts";
import { retentionPlexContext } from "./retention/fixtures/plex.ts";
import { prepareBoundRetention } from "./retention/lifecycle.test-fixture.ts";
import { createMediaFileActivities } from "./files/activities.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";

const { database, context } = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test.each(["acquisition", "restore"])(
  "Plex %s publication verifies all episodes sharing one file",
  async (mode) => {
    const db = database();
    const files = await sharedTvFileFixture(db, mappedPublicationFixture);
    directories.push(files.directory);
    const published = await preparePhysicalPublication(files);
    const mediaIds = published.entry.mediaIds;
    expect(mediaIds).toHaveLength(2);
    const transport = await retentionPlexContext(db, context(), mediaIds);
    let network = transport.context;
    const generation = published.entry.generations[files.media.id];
    if (generation === undefined)
      throw new Error("Publication omitted its generation");
    let input: { operationId: string; mediaId: string; generation: number } = {
      operationId: published.input.operationId,
      mediaId: files.media.id,
      generation,
    };
    if (mode === "restore") {
      const bound = await prepareBoundRetention(files, published, context());
      const activities = createMediaFileActivities(files.context);
      expect(
        await activities.quarantineMediaFiles(bound.retention.input),
      ).toEqual({ status: "quarantined" });
      await grantTestRequesterAccess(db, files.user.id, "fixture-server");
      const media = await db.mediaItem.findUniqueOrThrow({
        where: { id: files.media.id },
      });
      const command = await new PrismaMediaCommands(db, {
        keepDays: 30,
        serverMachineId: "fixture-server",
      }).act(files.user, crypto.randomUUID(), media.id, {
        action: "keep",
        expectedVersion: media.version,
      });
      if (command.operationId === undefined)
        throw new Error("Keep omitted restoration operation");
      const intent = await db.mediaIntent.findUniqueOrThrow({
        where: targetWhere(defaultScope(media.id)),
      });
      input = {
        mediaId: media.id,
        operationId: command.operationId,
        generation: intent.generation,
      };
      expect(await activities.restoreMediaFiles(input)).toEqual({
        status: "restored",
      });
      network = bound.context;
    }
    const priorIntents = await db.mediaIntent.findMany({
      where: { mediaId: { in: mediaIds }, edition: "default" },
    });
    const activities = createPublicationActivities(network);
    expect(
      mode === "restore"
        ? await activities.publishRestoredMedia(input)
        : await activities.publishMediaToPlex(published.input),
    ).toEqual({ status: "available", reason: null });
    expect(
      await db.mediaItem.count({
        where: { id: { in: mediaIds }, availability: "available" },
      }),
    ).toBe(2);
    const currentIntents = await db.mediaIntent.findMany({
      where: { mediaId: { in: mediaIds }, edition: "default" },
    });
    for (const prior of priorIntents)
      expect(
        currentIntents.find((intent) => intent.mediaId === prior.mediaId),
      ).toMatchObject({
        availability: "available",
        generation: prior.generation,
        version: prior.version,
        automationEpoch: prior.automationEpoch,
      });
    expect(
      await db.plexAssociationEvidence.count({
        where: { mediaId: { in: mediaIds } },
      }),
    ).toBeGreaterThanOrEqual(2);
    if (mode === "restore")
      expect(
        await db.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        }),
      ).toMatchObject({
        result: {
          restoreReceipt: { mediaIds: expect.arrayContaining(mediaIds) },
          plexScan: { sectionId: "2" },
        },
      });
  },
);

test("a correct Plex path with the wrong canonical movie identity stays unavailable", async () => {
  const db = database();
  const files = await mappedPublicationFixture(db);
  directories.push(files.directory);
  const published = await preparePhysicalPublication(files);
  const transport = await retentionPlexContext(
    db,
    context(),
    published.entry.mediaIds,
  );
  const item = transport.items.get(files.media.id);
  if (item === undefined)
    throw new Error("Physical publication omitted its Plex item");
  item.Guid = [{ id: `tmdb://${String((files.media.tmdbId ?? 0) + 1)}` }];
  expect(
    await createPublicationActivities(transport.context).publishMediaToPlex(
      published.input,
    ),
  ).toEqual({
    status: "blocked",
    reason: "metadata_changed",
  });
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: files.media.id } }),
  ).toMatchObject({ availability: "importing" });
  expect(
    await db.plexAssociationEvidence.count({
      where: { mediaId: files.media.id },
    }),
  ).toBe(0);
});

test("Plex verification cannot mark a concurrently quarantined asset available", async () => {
  const db = database();
  const files = await mappedPublicationFixture(db);
  directories.push(files.directory);
  const published = await preparePhysicalPublication(files);
  const transport = await retentionPlexContext(
    db,
    context(),
    published.entry.mediaIds,
  );
  let changed = false;
  transport.state.beforeMetadata = async () => {
    if (changed) return;
    changed = true;
    await db.libraryAsset.update({
      where: { id: published.entry.assetId },
      data: { state: "quarantined", version: { increment: 1 } },
    });
    await db.mediaItem.update({
      where: { id: files.media.id },
      data: { availability: "quarantined" },
    });
  };
  const result = await createPublicationActivities(
    transport.context,
  ).publishMediaToPlex(published.input);
  expect(changed).toBe(true);
  expect(result).toEqual({ status: "blocked", reason: "ownership_changed" });
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: files.media.id } }),
  ).toMatchObject({ availability: "quarantined" });
  expect(
    await db.plexAssociationEvidence.count({
      where: { mediaId: files.media.id },
    }),
  ).toBe(0);
});
