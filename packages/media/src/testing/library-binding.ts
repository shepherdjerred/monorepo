import { rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { libraryBindingFixture } from "#automation/plex-binding/library.test-fixture.ts";
import { createPlexBindingActivities } from "#automation/plex-binding/activities.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";

/** Isolated real PG/Files/queue fixture for the role-worker boundary; external responses remain synthetic. */
export async function createLibraryBindingWorkerFixture() {
  const cluster = await startMediaTestPostgres();
  const directories: string[] = [];
  const close = async () => {
    await cluster.close();
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  };
  try {
    const f = await libraryBindingFixture(
      cluster.database,
      "directors_cut",
      (directory) => directories.push(directory),
    );
    const operation = await cluster.database.operation.findUniqueOrThrow({
      where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
    });
    const input = LibraryPlexBindingInputV1Schema.parse(operation.payload);
    const finish = createOutboxActivities(cluster.database, () =>
      Promise.reject(
        new Error("No dispatch expected from operation completion"),
      ),
    );
    return {
      input,
      runtime: { plexBinding: createPlexBindingActivities(f.context) },
      close,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(cluster.database, start).dispatchMediaOutbox(),
      finishMediaOperation: finish.finishMediaOperation,
      evidence: async () => ({
        operation: await cluster.database.operation.findUniqueOrThrow({
          where: { id: input.operationId },
          include: { outbox: true },
        }),
        bindings: await cluster.database.plexBindingCurrent.findMany({
          where: { mediaId: f.network.media.id },
          include: { evidence: true },
        }),
        attempts: await cluster.database.acquisitionAttempt.count({
          where: { mediaIds: { has: f.network.media.id } },
        }),
        calls: [...f.calls],
      }),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
