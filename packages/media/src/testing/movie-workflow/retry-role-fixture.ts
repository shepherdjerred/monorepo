import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { MovieRetryRenewalEnvelopeV1Schema } from "#shared/movie-editions/retry/v1.ts";
import { createMovieWorkflowFixture } from "./fixture.ts";

/** Native Workflow history supplies terminal authority; only the external transfer read initially fails. */
export async function createMovieRetryWorkflowFixture(
  describe: MediaAutomationContext["describeWorkflow"],
) {
  const f = await createMovieWorkflowFixture("extended_cut");
  const db = f.source.db;
  let unavailable = true;
  f.source.context.describeWorkflow = describe;
  f.source.wire.control.beforeInfo = async () => {
    if (!unavailable) return;
    const attempt = await db.acquisitionAttempt.findUnique({
      where: { operationId: f.input.operationId },
    });
    if (
      attempt !== null &&
      attempt.torrentId !== null &&
      attempt.filePlan === null
    )
      throw new Error("Synthetic transfer observation unavailable");
  };
  const commands = new MovieLifecycleCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  return {
    ...f,
    async evidence() {
      const evidence = await f.evidence();
      return {
        ...evidence,
        torrentCount: await db.torrent.count(),
        seedingOperations: await db.operation.count({
          where: { kind: "maintain_torrent" },
        }),
      };
    },
    async renewal(operationId: string) {
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: operationId },
      });
      return MovieRetryRenewalEnvelopeV1Schema.parse(
        z.object({ movieRetryRenewalV1: z.json() }).parse(operation.result)
          .movieRetryRenewalV1,
      );
    },
    allowTransferObservation: () => {
      unavailable = false;
    },
    async retry() {
      const media = await db.mediaItem.findUniqueOrThrow({
        where: { id: f.input.mediaId },
      });
      const target = await db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.input.mediaId,
            edition: f.input.scope.edition,
          },
        },
      });
      const result = await commands.retryMovieEditionV4(
        f.source.user,
        crypto.randomUUID(),
        {
          schemaVersion: 4,
          scope: f.input.scope,
          expected: {
            mediaVersion: media.version,
            targetVersion: target.version,
          },
          command: { action: "retry" },
        },
      );
      return z.uuid().parse(result.result.operationId);
    },
    async authority() {
      return {
        target: await db.mediaIntent.findUniqueOrThrow({
          where: {
            mediaId_edition: {
              mediaId: f.input.mediaId,
              edition: f.input.scope.edition,
            },
          },
        }),
        requests: await db.mediaRequest.findMany({
          where: { mediaId: f.input.mediaId },
          orderBy: { id: "asc" },
        }),
        choices: await db.movieEditionChoice.findMany({
          where: { rootMediaId: f.input.mediaId },
          orderBy: { id: "asc" },
        }),
      };
    },
  };
}
