import { rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedMovieFixture } from "./managed-fixture.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";

/** Real import approval, physical adoption and verified binding precede the new scoped upgrade outbox. */
export async function createManagedMovieWorkflowFixture(
  edition: MovieEditionKey,
) {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  const directories: string[] = [];
  const close = async () => {
    try {
      await cluster.close();
    } finally {
      for (const directory of directories)
        await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    const original = await movieVideoFixture();
    const upgrade = await movieVideoFixture(3840, undefined, {
      bitrateKbps: 160_000,
    });
    const fixture = await createManagedMovieFixture(
      { database: () => db },
      edition,
      (directory) => directories.push(directory),
      { original, upgrade },
    );
    const completion = createOutboxActivities(db, () =>
      Promise.reject(new Error("Completion cannot dispatch")),
    );
    const selected = { mediaId: fixture.scope.mediaId, edition };
    return {
      input: fixture.input,
      movie: fixture.movie,
      fileMovie: fixture.fileMovie,
      originalAssetId: fixture.asset.id,
      receiptId: fixture.receiptId,
      finishMediaOperation: completion.finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(db, start).dispatchMediaOutbox(),
      evidence: async () => ({
        operation: await db.operation.findUniqueOrThrow({
          where: { id: fixture.input.operationId },
          include: { outbox: true },
        }),
        attempts: await db.acquisitionAttempt.findMany({
          where: { mediaIds: { has: fixture.scope.mediaId } },
          include: { reservations: true, torrent: true },
        }),
        assets: await db.libraryAsset.findMany({
          where: { coverage: { some: selected } },
          include: { coverage: true },
        }),
        binding: await db.plexBindingCurrent.findUniqueOrThrow({
          where: { mediaId_edition: selected },
        }),
        personalRequests: await db.mediaRequest.count({
          where: { mediaId: fixture.scope.mediaId },
        }),
        personalChoices: await db.movieEditionChoice.count({
          where: { rootMediaId: fixture.scope.mediaId },
        }),
        adds: fixture.wire.additions(),
      }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
