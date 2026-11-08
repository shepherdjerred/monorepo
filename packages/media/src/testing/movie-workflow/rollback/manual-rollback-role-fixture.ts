import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import { createManualMovieRollbackFixture } from "./manual-rollback-fixture.ts";
import { movieRollbackVideos } from "./rollback-fixture.ts";

/** The distinct real owner request already queued its private command/outbox.
 * Dispatch and completion use the production store, without status fabrication. */
export async function createManualMovieRollbackRoleFixture() {
  const f = await createManualMovieRollbackFixture(
    "directors_cut",
    await movieRollbackVideos(),
  );
  try {
    await f.db.mediaUser.update({
      where: { id: f.network.actor.id },
      data: { restricted: true },
    });
    const completion = createOutboxActivities(f.db, () =>
      Promise.reject(
        new Error("Completion cannot dispatch an unrelated Workflow"),
      ),
    );
    return {
      ...f,
      movie: { ...f.movie, ...f.manual },
      fileMovie: { ...f.fileMovie, ...f.manual },
      finishMediaOperation: completion.finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(f.db, start).dispatchMediaOutbox(),
      command: () =>
        f.db.operation.findUniqueOrThrow({
          where: { id: f.input.operationId },
          include: { outbox: true },
        }),
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
