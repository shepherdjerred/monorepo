import { z } from "zod";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { QualityRulesSchema } from "#shared/api.ts";

/** Real request, choice, reservation, add, cancellation and genuine new choice/generation. */
export async function movieTransferReuseFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
  options: { lostReply?: boolean; profileChange?: boolean } = {},
) {
  const f = await createMovieWorkflowFixture(edition, { bytes });
  try {
    const db = f.source.db;
    const first = await f.movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    const originalInput = {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      attemptId: z.uuid().parse(first.attemptId),
      scope: f.input.scope,
    };
    f.source.wire.control.loseAddReply = options.lostReply === true;
    await f.movie.submitMovieTorrentV4(
      originalInput,
      testPlexBindingExecution(),
    );
    const original = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: originalInput.attemptId },
    });
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: z.uuid().parse(original.sponsorRequestId) },
    });
    const target = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.input.mediaId, edition } },
    });
    const commands = new MovieLifecycleCommands(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
      movieSectionId: "1",
    });
    await commands.cancelMovieEditionRequest(
      f.source.user,
      crypto.randomUUID(),
      {
        schemaVersion: 3,
        action: "cancel_request",
        scope: f.input.scope,
        subjectUserId: f.source.user.id,
        requestId: request.id,
        expected: {
          targetVersion: target.version,
          requestVersion: request.version,
          choiceRevision: request.movieEditionChoiceRevision,
        },
      },
    );
    if (options.lostReply === true) {
      const { reconcileUnconfirmedSubmission } =
        await import("#automation/acquisition-management/recovery.ts");
      await reconcileUnconfirmedSubmission(f.source.context, original.id);
    }
    const origin = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: original.id },
      include: { torrent: true },
    });
    if (origin.torrent === null || origin.state !== "cancelled")
      throw new Error(
        "Real cancellation did not retain its registered owned source",
      );
    if (options.profileChange === true) {
      const profile = f.source.profile;
      await db.qualityProfileVersion.create({
        data: {
          profileId: profile.id,
          version: 1,
          rules: QualityRulesSchema.parse(profile.rules),
        },
      });
      await db.qualityProfile.update({
        where: { id: profile.id },
        data: { version: 1 },
      });
    }
    const next = await requestTestMovieV4(
      db,
      f.source.user,
      f.input.mediaId,
      edition,
    );
    const second = await f.movie.reconcileMovieIntentV4(
      next.input,
      testPlexBindingExecution(),
    );
    const input = {
      schemaVersion: 4 as const,
      operationId: next.input.operationId,
      attemptId: z.uuid().parse(second.attemptId),
      scope: next.input.scope,
    };
    const described: string[] = [];
    const originalCoordinator = z.uuid().parse(origin.coordinatorOperationId);
    const context: MediaAutomationContext = {
      ...f.source.context,
      describeWorkflow: (id: string) => {
        described.push(id);
        if (
          id !== `media-operation-${originalCoordinator}` &&
          id !== `media-acquire-${origin.id}`
        )
          throw new Error("Reuse described an unrelated origin");
        return Promise.resolve({
          status: "COMPLETED" as const,
          runId: `synthetic-closed:${id}`,
        });
      },
    };
    return {
      ...f,
      db,
      origin,
      input,
      next,
      context,
      described,
      movie: createMovieNetworkFacetV4(context),
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

export async function movieTransferSeedInput(
  f: Awaited<ReturnType<typeof movieTransferReuseFixture>>,
) {
  const torrentId = z.uuid().parse(f.origin.torrentId);
  const seed = await f.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `seed:${torrentId}` },
  });
  if (seed.kind !== "maintain_torrent")
    throw new Error("Actual source lost its original seed operation");
  return { operationId: seed.id, torrentId };
}

export async function movieTransferDependencyEvidence(
  f: Awaited<ReturnType<typeof movieTransferReuseFixture>>,
) {
  const attempts = await f.db.acquisitionAttempt.findMany({
    where: { torrentId: f.origin.torrentId },
    select: { id: true, state: true, filePlan: true },
  });
  return {
    attempts: attempts.map(({ id, state, filePlan }) => ({
      id,
      state,
      hasPlan: filePlan !== null,
    })),
    operations: await f.db.operation.findMany({
      where: { status: { in: ["queued", "running"] } },
      select: { id: true, kind: true, targetId: true, status: true },
    }),
    assets: await f.db.libraryAsset.findMany({
      where: { torrentId: f.origin.torrentId },
      select: { id: true, state: true },
    }),
    fences: await f.db.nativePublicationCompensationContinuation.findMany({
      select: { state: true, fenceRelease: true },
    }),
    replacements: await f.db.subtitleReplacement.findMany({
      select: { state: true, reservationActive: true },
    }),
    cleanups: await f.db.upgradeCleanup.findMany({ select: { state: true } }),
  };
}
