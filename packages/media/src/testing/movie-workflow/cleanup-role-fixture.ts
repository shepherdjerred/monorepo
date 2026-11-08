import { createMovieCleanupFixture } from "./cleanup-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { createAcquisitionFileFacet } from "#automation/acquisition-management/facets.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";

/** Actual acquisition, captions and upgrade precede the pending cleanup's real role-worker dispatch. */
export async function createMovieCleanupWorkflowFixture(
  edition: MovieEditionKey,
) {
  const f = await createMovieCleanupFixture(edition, {
    original: await movieVideoFixture(),
    upgrade: await movieVideoFixture(3840),
  });
  return {
    input: f.cleanupInput,
    scope: f.scope,
    acquisition: createAcquisitionFileFacet(f.files),
    ...createPlexRuntimeFacets(f.context, () => Promise.resolve(false)),
    finishMediaOperation: createOutboxActivities(f.db, () =>
      Promise.reject(new Error("Completion cannot dispatch")),
    ).finishMediaOperation,
    dispatch: (start: WorkflowStarter) =>
      createOutboxActivities(f.db, start).dispatchMediaOutbox(),
    evidence: async () => ({
      cleanup: await f.db.upgradeCleanup.findUniqueOrThrow({
        where: { id: f.cleanup.id },
      }),
      old: await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: f.old.id },
        include: { subtitles: true },
      }),
      successor: await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: f.successor.id },
      }),
      binding: await f.db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      }),
      publication: await f.db.operation.findUniqueOrThrow({
        where: { id: f.publication.id },
      }),
      transition: await f.db.mediaPublicationTransition.findUniqueOrThrow({
        where: { id: f.transition.id },
      }),
      operation: await f.db.operation.findUniqueOrThrow({
        where: { id: f.cleanupInput.operationId },
        include: { outbox: true },
      }),
    }),
    close: f.close,
  };
}
