import { rm } from "node:fs/promises";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import {
  bindingTestExecution,
  preparePhysicalPublication,
} from "#automation/plex-binding/test-fixture.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { mappedPublicationFixture } from "./test-fixture.ts";

/** Actual physical and Network producers; only the external Plex HTTP is synthetic. */
export async function verifiedPublicationFixture(
  db: Database,
  base: MediaAutomationContext,
  episode?: { seriesId: string; title?: string },
  fileFactory: typeof mappedPublicationFixture = mappedPublicationFixture,
) {
  const files = await fileFactory(db, episode);
  try {
    const published = await preparePhysicalPublication(files);
    const transport = await retentionPlexContext(
      db,
      base,
      published.attempt.mediaIds,
    );
    const context = {
      ...transport.context,
      plexBindingExecution: bindingTestExecution,
    };
    const publication = createPublicationActivities(context);
    const result = await publication.publishMediaToPlex(published.input);
    if (result.status !== "available")
      throw new Error(
        `Actual fixture publication failed: ${JSON.stringify(result)}`,
      );
    await publication.finalizeMediaAcquisition(published.input);
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    });
    return { files, published, asset, ...transport, context };
  } catch (error) {
    await rm(files.directory, { recursive: true, force: true });
    throw error;
  }
}
