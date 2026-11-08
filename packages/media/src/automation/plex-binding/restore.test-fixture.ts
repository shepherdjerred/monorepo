import { rm } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PlexClient } from "#integrations/plex.ts";
import { boundRetentionFixture } from "#automation/retention/lifecycle.test-fixture.ts";

let nextItem = 30_000;

export async function restoredPublicationFixture(
  db: Database,
  network: MediaAutomationContext,
) {
  let directory: string | undefined;
  try {
    const f = await boundRetentionFixture(db, network);
    directory = f.files.directory;
    const retention = f.retention;
    const physical = createMediaFileActivities(f.files.context);
    const removed = await physical.quarantineMediaFiles(retention.input);
    if (removed.status !== "quarantined")
      throw new Error(
        `Actual fixture quarantine failed: ${JSON.stringify(removed)}`,
      );
    const unknown = await f.observe(null);
    if (unknown.some((value) => value.complete))
      throw new Error("Missing quarantine metadata became a known watch value");
    const unwatched = await f.observe(false);
    if (unwatched.some((value) => !value.complete))
      throw new Error("Exact quarantined false did not settle");
    const restoreOperation = await db.operation.findFirstOrThrow({
      where: {
        kind: "restore_media",
        targetId: f.files.media.id,
        idempotencyKey: { startsWith: "plex-unwatched-restore:" },
      },
    });
    const input = z
      .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
      .parse(restoreOperation.payload);
    const restored = await physical.restoreMediaFiles(input);
    if (restored.status !== "restored")
      throw new Error(
        `Actual fixture restoration failed: ${JSON.stringify(restored)}`,
      );
    const mediaId = input.mediaId;
    const assetId = f.asset.id;
    const serverMachineId = "fixture-server";
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: mediaId },
    });
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: assetId },
    });
    if (media.kind !== "movie" || media.tmdbId === null)
      throw new Error("Restored fixture requires its actual canonical movie");
    const ratingKey = String(nextItem++);
    const item = {
      ratingKey,
      type: "movie",
      title: media.title,
      Guid: [{ id: `tmdb://${String(media.tmdbId)}` }],
      Media: [
        {
          Part: [
            { id: nextItem++, file: asset.path, size: Number(asset.sizeBytes) },
          ],
        },
      ],
    };
    const calls: string[] = [];
    const hooks: { beforeMetadata?: () => Promise<void> } = {};
    const context: MediaAutomationContext = {
      ...network,
      serverMachineId,
      plexAccess: (sectionType) => {
        if (sectionType !== "movie")
          throw new Error("Movie restoration must resolve only movie access");
        return Promise.resolve({
          serverMachineId,
          sectionType,
          sectionId: "1",
        });
      },
      plex: new PlexClient(
        {
          baseUrl: "http://plex.fixture",
          token: "synthetic",
          clientIdentifier: "restore-fixture",
        },
        async (url) => {
          calls.push(url.pathname);
          if (url.pathname === "/identity")
            return Response.json({
              MediaContainer: { machineIdentifier: serverMachineId },
            });
          if (url.pathname === "/library/sections")
            return Response.json({
              MediaContainer: {
                size: 1,
                Directory: [
                  { key: "1", type: "movie", title: "Synthetic movies" },
                ],
              },
            });
          if (url.pathname === "/library/sections/1/refresh")
            return new Response(null, { status: 200 });
          if (url.pathname === "/library/sections/1/all")
            return Response.json({
              MediaContainer: { size: 1, totalSize: 1, Metadata: [item] },
            });
          if (url.pathname === `/library/metadata/${ratingKey}`) {
            await hooks.beforeMetadata?.();
            return Response.json({
              MediaContainer: { size: 1, Metadata: [item] },
            });
          }
          throw new Error(
            `Unexpected restoration Plex request ${url.pathname}`,
          );
        },
      ),
    };
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const receipt = z
      .object({ restoreReceipt: z.json() })
      .parse(operation.result).restoreReceipt;
    return {
      directory,
      input,
      media,
      asset,
      operation,
      receipt,
      bindingPointers: await db.plexBindingCurrent.findMany({
        where: { mediaId },
        orderBy: { edition: "asc" },
      }),
      context,
      calls,
      hooks,
    };
  } catch (error) {
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
