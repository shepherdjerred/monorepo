import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { createMovieRetryWorkflowFixture } from "./retry-role-fixture.ts";
import { readMovieTransferReuseMarkerV1 } from "#infrastructure/movie-editions/transfer-reuse/read.ts";
import { createSeedingNetworkFacet } from "#automation/seeding/facet.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";

/** Native old/new executions provide closure. Every operation and choice comes from the real producer. */
export async function createMovieTransferReuseWorkflowFixture(
  describe: MediaAutomationContext["describeWorkflow"],
) {
  const f = await createMovieRetryWorkflowFixture(describe);
  const { db, context, user } = f.source;
  let consumerOperationId: string | null = null;
  return {
    ...f,
    seeding: createSeedingNetworkFacet(context),
    async command(operationId: string) {
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: operationId },
        include: { outbox: true },
      });
      if (
        operation.outbox === null ||
        JSON.stringify(operation.outbox.payload) !==
          JSON.stringify(operation.payload)
      )
        throw new Error(
          "Native source journey requires its actual matching outbox command",
        );
      return {
        operationId: operation.id,
        kind: operation.kind,
        payload: z.record(z.string(), z.json()).parse(operation.outbox.payload),
      };
    },
    async cancelAndSelectNewChoice() {
      const origin = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { operationId: f.input.operationId },
      });
      if (origin.filePlan !== null || origin.torrentId === null)
        throw new Error(
          "Native cancelled origin must retain its actual no-plan registered source",
        );
      const request = await db.mediaRequest.findUniqueOrThrow({
        where: { id: z.uuid().parse(origin.sponsorRequestId) },
      });
      const target = await db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.input.mediaId,
            edition: f.input.scope.edition,
          },
        },
      });
      await new MovieLifecycleCommands(db, {
        keepDays: 30,
        serverMachineId: "fixture-server",
        movieSectionId: "1",
      }).cancelMovieEditionRequest(user, crypto.randomUUID(), {
        schemaVersion: 3,
        action: "cancel_request",
        scope: f.input.scope,
        subjectUserId: user.id,
        requestId: request.id,
        expected: {
          targetVersion: target.version,
          requestVersion: request.version,
          choiceRevision: request.movieEditionChoiceRevision,
        },
      });
      f.allowTransferObservation();
      const selected = await requestTestMovieV4(
        db,
        user,
        f.input.mediaId,
        f.input.scope.edition,
      );
      consumerOperationId = selected.input.operationId;
      return selected.input;
    },
    async sourceState() {
      const origin = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { operationId: f.input.operationId },
        include: { torrent: true },
      });
      if (origin.torrent === null)
        throw new Error("Actual original transfer is missing");
      const seed = await db.operation.findUniqueOrThrow({
        where: { idempotencyKey: `seed:${origin.torrent.id}` },
      });
      return {
        origin,
        torrent: origin.torrent,
        seed: { operationId: seed.id, torrentId: origin.torrent.id },
      };
    },
    async consumer() {
      if (consumerOperationId === null)
        throw new Error("No genuine new choice was produced");
      const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { operationId: consumerOperationId },
      });
      if (attempt.torrentId === null)
        throw new Error("Actual new consumer has no transfer");
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: attempt.operationId },
      });
      const grant = readMovieTransferReuseMarkerV1(operation.result);
      if (grant === null)
        throw new Error("Actual new consumer has no immutable transfer grant");
      const assets = await db.libraryAsset.findMany({
        where: { torrentId: attempt.torrentId },
        include: { subtitles: true },
      });
      return {
        attempt,
        operation,
        grant,
        assets,
        sourcePhysicalPath: workerFilePath(
          f.source.files.context,
          grant.transfer.contentPath,
        ),
        physicalPaths: assets.flatMap((asset) => [
          workerFilePath(f.source.files.context, asset.path),
          ...asset.subtitles.flatMap((subtitle) =>
            subtitle.path === null
              ? []
              : [workerFilePath(f.source.files.context, subtitle.path)],
          ),
        ]),
      };
    },
    async captionCommands() {
      if (consumerOperationId === null)
        throw new Error("No actual new consumer exists");
      const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { operationId: consumerOperationId },
      });
      if (attempt.torrentId === null)
        throw new Error("Actual consumer source is missing");
      const assets = await db.libraryAsset.findMany({
        where: { torrentId: attempt.torrentId },
      });
      return db.operation.findMany({
        where: {
          kind: "acquire_movie_subtitles_v4",
          targetId: { in: assets.map((asset) => asset.id) },
        },
        orderBy: { id: "asc" },
      });
    },
  };
}
