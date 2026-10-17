import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeQuarantineFixture } from "#automation/native-quarantine/test-fixture.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("a fresh authorized request resumes physically restored quarantine without rewriting the historical receipt, then verifies Plex", async () => {
  const db = harness.database();
  const f = await nativeQuarantineFixture(db, harness.context().cipher);
  directories.push(f.file.directory);
  await f.apply();
  const first = await f.positiveRestore();
  await f.activities.restoreNativeQuarantineFiles(first);
  const restored = await db.nativeQuarantineContinuation.findUniqueOrThrow({
    where: { id: first.continuationId },
  });
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  await db.plexIdentityMapping.upsert({
    where: { userId: f.file.user.id },
    create: {
      userId: f.file.user.id,
      serverMachineId: "server",
      kind: "account",
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      verifiedAt: new Date(),
    },
    update: {
      serverMachineId: "server",
      kind: "account",
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      verifiedAt: new Date(),
    },
  });
  const commands = new PrismaMediaCommands(db, {
    keepDays: 30,
    serverMachineId: "server",
  });
  const requested = await commands.createRequest(
    f.file.user,
    crypto.randomUUID(),
    { mediaId: f.file.media.id, subtitleLanguages: [], includeSpecials: false },
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(requested.operationId) },
  });
  expect(operation.kind).toBe("restore_native_quarantine");
  const input = z
    .object({
      operationId: z.uuid(),
      continuationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int(),
    })
    .parse(operation.payload);
  expect(input.generation).toBeGreaterThan(first.generation);
  expect(await f.activities.restoreNativeQuarantineFiles(input)).toEqual({
    status: "restored",
  });
  const replayed = await db.nativeQuarantineContinuation.findUniqueOrThrow({
    where: { id: first.continuationId },
  });
  expect(replayed.restoration).toEqual(restored.restoration);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ).toEqual(asset);
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.file.media.id },
  });
  const context = harness.context(async (url) => {
    if (url.pathname.endsWith("/library/sections"))
      return Response.json({
        MediaContainer: {
          size: 1,
          Directory: [{ key: "1", title: "Movies", type: "movie" }],
        },
      });
    if (url.pathname.endsWith("/refresh")) return new Response();
    if (
      url.pathname.endsWith("/all") ||
      url.pathname.endsWith("/metadata/99123")
    )
      return Response.json({
        MediaContainer: {
          size: 1,
          totalSize: 1,
          Metadata: [
            {
              ratingKey: "99123",
              title: media.title,
              type: "movie",
              Guid: [{ id: `tmdb://${String(media.tmdbId)}` }],
              Media: [{ Part: [{ id: 1, file: asset.path }] }],
            },
          ],
        },
      });
    throw new Error("Unexpected native publication network call");
  });
  expect(
    await createPublicationActivities(context).publishRestoredMedia(input),
  ).toEqual({ status: "available", reason: null });
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: media.id } }),
  ).toMatchObject({ availability: "available" });
  expect(
    await db.retentionDecision.findFirstOrThrow({
      where: { mediaId: media.id },
    }),
  ).toMatchObject({ state: "quarantined" });
});
