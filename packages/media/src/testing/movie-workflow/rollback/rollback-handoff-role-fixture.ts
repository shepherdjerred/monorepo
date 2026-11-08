import type { MediaAutomationContext } from "#automation/context.ts";
import { z } from "zod";
import { createRequestedMovieRollbackNetworkFacetV1 } from "#automation/movie-editions/rollback/manual-facet.ts";
import { PrismaMovieRollbackCommandsV1 } from "#infrastructure/movie-editions/rollback/manual/manual-command.ts";
import { captureMovieRollbackRetryContextV1 } from "#infrastructure/movie-editions/rollback/retry/retry-context.ts";
import { readMovieRollbackIntentV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";
import { createManualMovieRollbackRoleFixture } from "./manual-rollback-role-fixture.ts";

/** A real admitted owner can stop after a native ACK. The description port is
 * supplied by the actual Temporal test server, never a fabricated terminal row. */
export async function createMovieRollbackHandoffRoleFixture(
  describe: MediaAutomationContext["describeWorkflow"],
) {
  const f = await createManualMovieRollbackRoleFixture();
  try {
    const sections = await f.context.permittedSections();
    const settings = {
      keepDays: 30,
      serverMachineId: z.string().min(1).parse(f.context.serverMachineId),
      movieSectionId: sections.movie,
    };
    const service = new PrismaMovieRollbackCommandsV1(f.db, settings, describe);
    const network = createRequestedMovieRollbackNetworkFacetV1({
      ...f.context,
      describeWorkflow: describe,
    });
    return {
      ...f,
      movie: { ...f.movie, ...network },
      service,
      unknownService: new PrismaMovieRollbackCommandsV1(f.db, settings, () =>
        Promise.resolve(null),
      ),
      retryReview: async () => {
        const invocation = {
          execution: testPlexBindingExecution(),
          budget: new PublicationAuthorityReadBudget(),
        };
        return f.db.$transaction(async (tx) => {
          const parent = await readMovieRollbackIntentV1(
            tx,
            {
              mode: "manual_verified",
              command: f.input,
              source: f.sourceInput,
            },
            invocation.budget,
          );
          if (parent === null)
            throw new Error("Real rollback admission is absent");
          const current = await captureMovieRollbackRetryContextV1(tx, {
            parent,
            actorId: f.owner.id,
            access: settings,
            invocation,
          });
          return {
            schemaVersion: 1 as const,
            scope: f.scope,
            sourceAttemptId: f.sourceInput.attemptId,
            resume: {
              operationId: f.input.operationId,
              intentHash: parent.intentHash,
            },
            expected: current.expected,
            reason:
              "Resume the exact admitted inverse after its actual executor stopped",
            confirmResumeAdmittedRollback: true as const,
          };
        });
      },
      handoffs: () =>
        f.db.applicationEvent.findMany({
          where: {
            kind: "movie_rollback_owner_handoff_v1",
            mediaId: f.scope.mediaId,
          },
          orderBy: { id: "asc" },
        }),
      retryCommands: () =>
        f.db.operation.findMany({
          where: {
            kind: "rollback_movie_edition_v1",
            payload: {
              path: ["resume", "operationId"],
              equals: f.input.operationId,
            },
          },
          orderBy: { id: "asc" },
        }),
      captionRecords: async () => {
        const receipts = await f.receipts();
        const admitted = receipts.movieRollbackIntentV1;
        const manifest = admitted?.intent.captionManifest;
        if (admitted === undefined || manifest === undefined)
          throw new Error("Real rollback caption admission is absent");
        return inspectPublicationRecords(f.files.roots.movies, {
          transitionId: admitted.intent.id,
          continuationId: null,
          maxRecords: manifest.captions.length * 3,
          maxRecordBytes:
            Buffer.byteLength(JSON.stringify(manifest)) * 64 + 262_144,
          checkpoint: () => Promise.resolve(),
        });
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
