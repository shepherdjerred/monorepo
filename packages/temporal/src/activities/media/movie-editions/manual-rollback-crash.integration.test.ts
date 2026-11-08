import { expect, test } from "vitest";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { createManualMovieRollbackFixture } from "@shepherdjerred/media/testing/movie-manual-rollback-workflow";
import { inspectPublicationRecords } from "@shepherdjerred/media/filesystem/publication-proof/records";
import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";
import { manualMovieRollbackWorkers } from "./manual-rollback-sdk.test-support.ts";

import { useMovieRollbackVideos } from "#activities/media/testing/rollback-fixtures.ts";

const rollbackInputs = useMovieRollbackVideos();

test.each(["move_link", "move_unlink", "journal_complete"] as const)(
  "manual B-caption durable %s ACK resumes before original A inverse without recreating an import",
  async (step) => {
    const f = await createManualMovieRollbackFixture(
      "extended_cut",
      rollbackInputs.videos(),
    );
    rollbackInputs.closeAfterTest(f.close);
    const workers = manualMovieRollbackWorkers(() => Promise.resolve(f.manual));
    const runId = crypto.randomUUID();
    const sdk = (activityId: string) =>
      movieRollbackSdkEnvironment({
        workflowExecution: {
          workflowId: `media-operation-${f.input.operationId}`,
          runId,
        },
        activityId,
        scheduledTimestampMs: Date.now(),
        currentAttemptScheduledTimestampMs: Date.now(),
        startToCloseTimeoutMs: 120_000,
        scheduleToCloseTimeoutMs: 180_000,
        heartbeatTimeoutMs: 30_000,
      });
    expect(
      await sdk("admission-observation").run(
        workers.observeRequestedMovieRollbackV1,
        f.input,
      ),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await sdk("admission").run(
        workers.prepareRequestedMovieRollbackV1,
        f.input,
      ),
    ).toEqual({ status: "prepared", reason: null });
    const admittedReceipts = await f.receipts();
    const admitted = admittedReceipts.movieRollbackIntentV1;
    const manifest = admitted?.intent.captionManifest;
    if (admitted === undefined || manifest === undefined)
      throw new Error(
        "Actual manual admission did not produce its caption manifest",
      );
    const before = await f.state();
    const immutable = await f.immutable();
    const records = () =>
      inspectPublicationRecords(f.files.roots.movies, {
        transitionId: admitted.intent.id,
        continuationId: null,
        maxRecords: manifest.captions.length * 3,
        maxRecordBytes:
          Buffer.byteLength(JSON.stringify(manifest)) * 64 + 262_144,
        checkpoint: () => Promise.resolve(),
      });
    expect(
      await sdk("pre-inverse-observation").run(
        workers.observeRequestedMovieRollbackV1,
        f.input,
      ),
    ).toEqual({ status: "ready", reason: null });
    let stopped = false;
    f.setCheckpoint((phase) => {
      if (!stopped && phase === `movie-rollback-caption-effect-ack:${step}`) {
        stopped = true;
        throw new Error(
          "Synthetic interruption after actual durable B-caption ACK",
        );
      }
      return Promise.resolve();
    });
    await expect(
      sdk("inverse").run(workers.rollbackRequestedMoviePublicationV1, f.input),
    ).rejects.toMatchObject({ type: "CompensationActivityFailure" });
    expect(stopped).toBe(true);
    f.setCheckpoint(null);
    const prefix = await records();
    const expectedPrefix = [
      "move_link",
      "move_unlink",
      "journal_complete",
    ].slice(
      0,
      ["move_link", "move_unlink", "journal_complete"].indexOf(step) + 1,
    );
    expect(prefix.records.map(({ record }) => record.effect.step)).toEqual(
      expectedPrefix,
    );
    const first = manifest.captions[0];
    if (first === undefined)
      throw new Error("Manual crash fixture lost its real first caption");
    const retained = await lstat(
      path.join(f.files.roots.movies.control, first.target.path),
      { bigint: true },
    );
    expect(retained.ino.toString()).toBe(first.source.identity.inode);
    expect(retained.dev.toString()).toBe(first.source.identity.device);
    expect(
      await f.db.libraryAsset.findMany({
        where: { id: { in: before.assets.map((asset) => asset.id) } },
        include: { subtitles: { orderBy: { id: "asc" } } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before.assets);
    const interruptedReceipts = await f.receipts();
    expect(interruptedReceipts.movieRollbackIntentV1).toEqual(admitted);
    expect(interruptedReceipts.movieRollbackPhysicalV1).toBeUndefined();
    expect(await f.immutable()).toEqual(immutable);
    f.setPlayback(true);
    expect(
      await sdk("active-after-admission").run(
        workers.observeRequestedMovieRollbackV1,
        f.input,
      ),
    ).toEqual({ status: "blocked", reason: "active_playback" });
    f.setPlayback(false);
    expect(
      await sdk("fresh-resume-observation").run(
        workers.observeRequestedMovieRollbackV1,
        f.input,
      ),
    ).toEqual({ status: "ready", reason: null });
    let firstInverseSawCompleteCaptions = false;
    f.setCheckpoint(async (phase) => {
      if (
        !firstInverseSawCompleteCaptions &&
        phase.startsWith("publication-effect-ack:")
      ) {
        const completed = await records();
        expect(completed.records).toHaveLength(manifest.captions.length * 3);
        expect(completed.records.slice(0, prefix.records.length)).toEqual(
          prefix.records,
        );
        firstInverseSawCompleteCaptions = true;
      }
    });
    expect(
      await sdk("inverse-resume").run(
        workers.rollbackRequestedMoviePublicationV1,
        f.input,
      ),
    ).toEqual({ status: "physically_rolled_back", reason: null });
    expect(firstInverseSawCompleteCaptions).toBe(true);
    f.setCheckpoint(null);
    const completed = await records();
    expect(completed.records).toHaveLength(manifest.captions.length * 3);
    expect(completed.records.slice(0, prefix.records.length)).toEqual(
      prefix.records,
    );
    expect(
      await sdk("rebind-a").run(
        workers.verifyRequestedMovieRollbackV1,
        f.input,
      ),
    ).toEqual({ status: "available", reason: null });
    const final = await f.state();
    expect(final.cleanup).toEqual(before.cleanup);
    expect(final.files.map(({ path: _path, ...file }) => file)).toEqual(
      before.files.map(({ path: _path, ...file }) => file),
    );
    expect(await f.immutable()).toEqual(immutable);
    expect(
      workers.invocations.every(
        (invocation) => invocation.paid > 0 && invocation.paid <= 100,
      ),
    ).toBe(true);
  },
  60_000,
);
