import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { createRequestedMovieRollbackNetworkFacetV1 } from "#automation/movie-editions/rollback/manual-facet.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";
import { PrismaMovieRollbackCommandsV1 } from "#infrastructure/movie-editions/rollback/manual/manual-command.ts";
import { readMovieRollbackIntentV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { captureMovieRollbackRetryContextV1 } from "#infrastructure/movie-editions/rollback/retry/retry-context.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MovieRollbackIntentEnvelopeV1Schema,
  MovieRollbackPhysicalEnvelopeV1Schema,
} from "#shared/movie-editions/rollback/physical.ts";
import { MovieRollbackPlexEnvelopeV1Schema } from "#shared/movie-editions/rollback/plex.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { createMovieRollbackRoleFixture } from "./rollback-role-fixture.ts";
import { traceAutomaticHandoffVerification } from "./automatic-rollback-handoff-diagnostics.ts";

/** Actual B physical publication and the existing rejected-Plex coordinator.
 * Only the caller's real Temporal server supplies execution observations. */
export async function createAutomaticMovieRollbackHandoffFixture(
  describe: MediaAutomationContext["describeWorkflow"],
) {
  const f = await createMovieRollbackRoleFixture();
  try {
    const existingOwner = await f.db.mediaUser.findFirstOrThrow({
      where: { role: "owner", restricted: false },
    });
    const owner = await authenticateMovieFixtureOwner(f.context, existingOwner);
    const sections = await f.context.permittedSections();
    const settings = {
      keepDays: 30,
      serverMachineId: z.string().min(1).parse(f.context.serverMachineId),
      movieSectionId: sections.movie,
    };
    let checkpoint: ((phase: string) => Promise<void>) | undefined;
    const fileMovie = createMovieFileFacetV4({
      ...f.files,
      checkpoint: async (phase) => {
        await f.files.checkpoint(phase);
        await checkpoint?.(phase);
      },
    });
    const network = createRequestedMovieRollbackNetworkFacetV1({
      ...f.context,
      describeWorkflow: describe,
    });
    const movie = {
      ...f.movie,
      ...network,
      verifyRequestedMovieRollbackV1: (
        ...args: Parameters<typeof network.verifyRequestedMovieRollbackV1>
      ) =>
        traceAutomaticHandoffVerification(
          args[2],
          [
            f.files.roots.movies.library,
            f.files.roots.movies.control,
            f.files.roots.movies.downloads,
            "/data/movies",
            "/downloads",
          ],
          () => network.verifyRequestedMovieRollbackV1(...args),
        ),
    };
    const receipts = async () => {
      const source = await f.db.operation.findUniqueOrThrow({
        where: { id: f.input.operationId },
      });
      return z
        .object({
          movieRollbackIntentV1: MovieRollbackIntentEnvelopeV1Schema.optional(),
          movieRollbackPhysicalV1:
            MovieRollbackPhysicalEnvelopeV1Schema.optional(),
          movieRollbackPlexV1: MovieRollbackPlexEnvelopeV1Schema.optional(),
        })
        .parse(source.result);
    };
    return {
      ...f,
      owner,
      movie,
      fileMovie,
      service: new PrismaMovieRollbackCommandsV1(f.db, settings, describe),
      unknownService: new PrismaMovieRollbackCommandsV1(f.db, settings, () =>
        Promise.resolve(null),
      ),
      setCheckpoint: (next: typeof checkpoint) => {
        checkpoint = next;
      },
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(f.db, start).dispatchMediaOutbox(),
      receipts,
      retryReview: async () => {
        const invocation = {
          execution: testPlexBindingExecution(),
          budget: new PublicationAuthorityReadBudget(),
        };
        return f.db.$transaction(async (tx) => {
          const parent = await readMovieRollbackIntentV1(
            tx,
            {
              mode: "automatic_failed_plex",
              source: f.input,
            },
            invocation.budget,
          );
          if (parent === null)
            throw new Error("Actual automatic rollback admission missing");
          const current = await captureMovieRollbackRetryContextV1(tx, {
            parent,
            actorId: owner.id,
            access: settings,
            invocation,
          });
          return {
            schemaVersion: 1 as const,
            scope: f.scope,
            sourceAttemptId: f.input.attemptId,
            resume: {
              operationId: f.input.operationId,
              intentHash: parent.intentHash,
            },
            expected: current.expected,
            reason:
              "Resume the actual admitted automatic inverse after both original executors stopped",
            confirmResumeAdmittedRollback: true as const,
          };
        });
      },
      handoffs: () =>
        f.db.applicationEvent.findMany({
          where: {
            mediaId: f.scope.mediaId,
            kind: "movie_rollback_owner_handoff_v1",
          },
          orderBy: { id: "asc" },
        }),
      playback: () =>
        f.db.applicationEvent.findMany({
          where: {
            mediaId: f.scope.mediaId,
            kind: "movie_rollback_retry_playback_v1",
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
      inverseRecords: async () => {
        const recorded = await receipts();
        const admitted = recorded.movieRollbackIntentV1;
        if (admitted === undefined)
          throw new Error("Actual automatic rollback intent missing");
        const plan = [admitted.intent.source.reference.intent.entries[0].entry];
        return inspectPublicationRecords(f.files.roots.movies, {
          transitionId: admitted.intent.source.reference.transitionId,
          continuationId: admitted.intent.id,
          maxRecords: plan.reduce(
            (count, entry) => count + 12 + entry.previousSidecars.length * 8,
            0,
          ),
          maxRecordBytes:
            Buffer.byteLength(JSON.stringify(publicationReferences(plan))) *
              64 +
            262_144,
          checkpoint: () => Promise.resolve(),
        });
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
