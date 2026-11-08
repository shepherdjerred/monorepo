import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";
import { expect, test } from "vitest";
import { createMovieRollbackLineageFixture } from "@shepherdjerred/media/testing/movie-rollback-lineage-workflow";
import { movieRollbackVideos } from "@shepherdjerred/media/testing/movie-rollback-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import { callMovieSubtitleReplacementV2 } from "./subtitle-replacement.ts";
import {
  traceOriginalMovieReads,
  type MovieRollbackReadCharge,
} from "./rollback-lineage-budget.test-support.ts";

function sdkForWorkflow(workflowId: string) {
  const runId = crypto.randomUUID();
  return (activityId: string) =>
    movieRollbackSdkEnvironment({
      workflowExecution: { workflowId, runId },
      activityId,
      scheduledTimestampMs: Date.now(),
      currentAttemptScheduledTimestampMs: Date.now(),
      startToCloseTimeoutMs: 120_000,
      scheduleToCloseTimeoutMs: 180_000,
      heartbeatTimeoutMs: 30_000,
    });
}

test("actual rollback parent supports caption replacement and genuine later C while automatic search rejects B", async () => {
  const f = await createMovieRollbackLineageFixture(
    "extended_cut",
    await movieRollbackVideos(),
  );
  try {
    const sdk = sdkForWorkflow(`media-acquire-${f.input.attemptId}`);
    const preparationReads: MovieRollbackReadCharge[] = [];
    const fileMovie = {
      ...f.fileMovie,
      prepareMoviePublicationV4: (
        ...args: Parameters<typeof f.fileMovie.prepareMoviePublicationV4>
      ) =>
        traceOriginalMovieReads(args[2], {
          reads: preparationReads,
          work: () => f.fileMovie.prepareMoviePublicationV4(...args),
        }),
    };
    const files = createMovieFileWorkerActivitiesV4(() =>
      Promise.resolve({ movie: fileMovie }),
    );
    const rejected = createMovieNetworkWorkerActivitiesV4(() =>
      Promise.resolve({ movie: f.rejectedMovie }),
    );
    const network = createMovieNetworkWorkerActivitiesV4(() =>
      Promise.resolve({ movie: f.movie }),
    );
    const original = await f.immutable();
    const rejectedResult = await sdk("actual-rejection").run(
      rejected.publishMovieWithRollbackV4,
      f.input,
    );
    expect(rejectedResult.status).toBe("waiting");
    expect(
      await sdk("admit-inverse").run(files.prepareMovieRollbackV4, f.input),
    ).toEqual({ status: "prepared", reason: null });
    expect(
      await sdk("physical-inverse").run(
        files.rollbackMoviePublicationV4,
        f.input,
      ),
    ).toEqual({ status: "physically_rolled_back", reason: null });
    expect(
      await sdk("original-item-rebind").run(
        network.verifyRolledBackMoviePlexV4,
        f.input,
      ),
    ).toEqual({ status: "available", reason: null });
    const replacement = await f.replacement();
    const captionSdk = sdkForWorkflow(
      `subtitle-replacement:${replacement.prepareInput.replacementId}`,
    );
    const captionReads: MovieRollbackReadCharge[] = [];
    const movieReplacement = (
      ...args: Parameters<typeof replacement.movieReplacement>
    ) =>
      traceOriginalMovieReads(args[2].budget, {
        reads: captionReads,
        work: () => replacement.movieReplacement(...args),
      });
    const loadReplacement = () => Promise.resolve({ movieReplacement });
    const preparedCaption = await captionSdk("prepare-caption").run(() =>
      callMovieSubtitleReplacementV2(
        loadReplacement,
        "prepareSubtitleReplacement",
        replacement.prepareInput,
      ),
    );
    expect(preparedCaption).toEqual({ state: "ready" });
    const approved = await replacement.approve();
    captionReads.length = 0;
    const appliedCaption = await captionSdk("replace-caption").run(() =>
      callMovieSubtitleReplacementV2(
        loadReplacement,
        "applySubtitleReplacement",
        approved,
      ),
    );
    if (appliedCaption.state !== "applied")
      throw new Error(
        `Actual rollback caption outcome and paid reads: ${JSON.stringify({ appliedCaption, captionReads })}`,
      );
    expect(appliedCaption).toEqual({ state: "applied" });
    const caption = await replacement.row();
    expect(caption.snapshot).toMatchObject({
      publication: {
        kind: "movie_rollback_publication_v1",
        operationId: f.input.operationId,
      },
    });
    expect(caption.receipt?.outcome).toBe("installed");

    const c = await f.laterC();
    const next = createMovieNetworkWorkerActivitiesV4(() =>
      Promise.resolve({ movie: c.movie }),
    );
    expect(
      await sdk("automatic-b-only").run(next.reconcileMovieIntentV4, c.input),
    ).toEqual({
      status: "waiting",
      attemptId: null,
      reason: "no_acceptable_release",
    });
    expect(
      await f.db.acquisitionAttempt.count({
        where: { operationId: c.input.operationId },
      }),
    ).toBe(0);
    c.offerC();
    const selected = await sdk("automatic-b-and-c").run(
      next.reconcileMovieIntentV4,
      c.input,
    );
    expect(selected.status).toBe("acquire");
    if (selected.attemptId === null)
      throw new Error("Later C did not create its actual acquisition attempt");
    const input = {
      schemaVersion: 4 as const,
      operationId: c.input.operationId,
      attemptId: selected.attemptId,
      scope: f.scope,
    };
    const nextSdk = sdkForWorkflow(`media-acquire-${input.attemptId}`);
    expect(
      await nextSdk("submit-c").run(next.submitMovieTorrentV4, input),
    ).toEqual({ status: "submitted", reason: null });
    expect(
      await nextSdk("observe-c").run(next.observeMovieAcquisitionV4, input),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await nextSdk("stage-c").run(files.inspectAndStageMovieV4, input),
    ).toEqual({ status: "staged" });
    const preparedC = await nextSdk("prepare-c").run(
      files.prepareMoviePublicationV4,
      input,
    );
    if (preparedC.status !== "prepared")
      throw new Error(
        `Actual C preparation outcome and paid reads: ${JSON.stringify({ preparedC, preparationReads })}`,
      );
    expect(preparedC).toEqual({ status: "prepared" });
    await c.captureControls(input.attemptId);
    const intent = await c.publication(input.attemptId);
    expect(intent.entries[0].originalGrant).toMatchObject({
      kind: "movie_rollback_publication_v1",
      operationId: f.input.operationId,
      assetId: f.asset.id,
      assetVersion: f.baseline.version + 2,
    });
    expect(intent.entries[0].originalGrant?.subtitleLineage).toBeDefined();
    expect(
      await nextSdk("promote-c").run(files.promoteMovieFilesV4, input),
    ).toEqual({ status: "published" });
    expect(
      await nextSdk("verify-c").run(next.publishMovieToPlexV4, input),
    ).toEqual({ status: "available", reason: null });
    await nextSdk("finalize-c").run(next.finalizeMovieAcquisitionV4, input);
    const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
      include: { torrent: true },
    });
    expect(attempt.torrent?.infoHash).toBe(c.expectedHash);
    expect(c.wire.additions()).toBe(1);
    expect(f.wire.additions()).toBe(1);
    const after = await f.immutable();
    expect(
      after.attempts.filter((row) =>
        original.attempts.some((old) => old.id === row.id),
      ),
    ).toEqual(original.attempts);
    expect(
      after.transitions.filter((row) =>
        original.transitions.some((old) => old.id === row.id),
      ),
    ).toEqual(original.transitions);
    expect(
      after.originalServing.filter((row) =>
        original.originalServing.some((old) => old.id === row.id),
      ),
    ).toEqual(original.originalServing);
  } finally {
    await f.close();
  }
}, 60_000);
