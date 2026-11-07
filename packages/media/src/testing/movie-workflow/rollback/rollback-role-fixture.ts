import { z } from "zod";
import { createOutboxActivities } from "#automation/store.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  createMovieRollbackFixture,
  movieRollbackVideos,
} from "./rollback-fixture.ts";

/** Real B physical publication precedes actual root/child ownership; each rejected observation calls the production Plex verifier. */
export async function createMovieRollbackRoleFixture() {
  const f = await createMovieRollbackFixture(
    "directors_cut",
    await movieRollbackVideos(),
  );
  try {
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
      include: { outbox: true },
    });
    if (
      operation.outbox === null ||
      JSON.stringify(operation.payload) !==
        JSON.stringify(operation.outbox.payload)
    )
      throw new Error(
        "Actual rollback root requires its matching immutable outbox input",
      );
    const rootInput = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(operation.outbox.payload),
    );
    const results: { status: string; reason: string | null }[] = [];
    const completion = createOutboxActivities(f.db, () =>
      Promise.reject(new Error("Completion cannot dispatch another workflow")),
    );
    return {
      ...f,
      rootInput,
      results,
      finishMediaOperation: completion.finishMediaOperation,
      movie: {
        ...f.movie,
        publishMovieWithRollbackV4: async (
          ...args: Parameters<typeof f.rejectedMovie.publishMovieWithRollbackV4>
        ) => {
          const result = await f.rejectedMovie.publishMovieWithRollbackV4(
            ...args,
          );
          results.push(result);
          return result;
        },
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
