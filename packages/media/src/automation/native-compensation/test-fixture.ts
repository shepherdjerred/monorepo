import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import type {
  AcquisitionAttempt,
  MediaPublicationTransition,
} from "#generated/prisma/client.ts";
import { nativeStorageFixture } from "#automation/native-recovery/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PrismaNativeCompensation } from "#infrastructure/native-compensation/service.ts";
import { createNativePlexObserver } from "#migration/native-plex/review.ts";
import { observePairedCompensationExecution } from "#migration/native-plex/compensation.ts";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { compensationNativePlexFixture } from "./fixtures/native-plex.ts";
import type { NativeCompensationObserverContext } from "#migration/native-compensation/evidence.ts";
import type {
  NativeCompensationActivityInput,
  NativeCompensationExecutionContext,
} from "#shared/native-recovery/compensation-runtime.ts";
import { createNativeCompensationFileActivities } from "./activities.ts";
import { configureArchiveTvPlex } from "#automation/native-archive/fixtures/shared-tv.ts";
import {
  grantNativePredecessor,
  restoreNativeFixtureAgain,
} from "./native-grant-fixture.ts";
import { abandonNativeReplacement } from "./replacement-fixture.ts";
import { killPublicationChild } from "./fixtures/kill-publication.ts";
import { embeddedFixtureSource } from "#automation/publication-proof/embedded-fixture.ts";
import { chooseCurrentTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";

export function testCompensationExecution(): NativeCompensationExecutionContext {
  const signal = new AbortController().signal;
  const wall = Date.now() + 300_000;
  const monotonic = performance.now() + 300_000;
  return {
    expiresAtMs: wall,
    signal,
    checkpoint: () => Promise.resolve(),
    assertActive: () => {
      signal.throwIfAborted();
      if (Date.now() >= wall || performance.now() >= monotonic)
        throw new Error("Synthetic compensation invocation expired");
    },
  };
}

/** Actual publication effects, rolled-back PG transaction, then real restore; no stored path rewriting. */
export async function nativeCompensationFixture(
  db: Database,
  cipher: CredentialCipher,
  options: {
    stopAt?: "sidecar" | "sidecar_link" | "video";
    embeddedSuccessor?: boolean;
    processKill?: boolean;
    unacknowledgedKill?: boolean;
    nativePredecessor?: boolean;
    abandonedReplacement?: boolean;
    omitLegacySubtitlePolicy?: boolean;
    fileFactory?: () => Promise<
      Awaited<ReturnType<typeof mappedPublicationFixture>>
    >;
  } = {},
) {
  let directory: string | undefined;
  let interrupted:
    | Awaited<
        ReturnType<
          Awaited<ReturnType<typeof mappedPublicationFixture>>["acquisition"]
        >
      >
    | undefined;
  let beforeRestore:
    | { attempt: AcquisitionAttempt; transition: MediaPublicationTransition }
    | undefined;
  try {
    const interrupt = async ({
      file,
    }: Pick<Awaited<ReturnType<typeof nativeStorageFixture>>, "file">) => {
      const inspect = file.context.inspect;
      if (inspect === undefined)
        throw new Error("Actual fixture probe missing");
      file.context.inspect = async (name) => {
        const measured = await inspect(name);
        return {
          ...measured,
          streams: measured.streams.map((stream) =>
            stream.codec_type === "video"
              ? { ...stream, width: 3840, height: 1600 }
              : stream,
          ),
        };
      };
      if (options.embeddedSuccessor === true)
        await db.mediaRequest.update({
          where: { id: file.request.id },
          data: { subtitleLanguages: ["en"], version: { increment: 1 } },
        });
      interrupted = await file.acquisition("Actual interrupted successor D");
      if (options.embeddedSuccessor === true)
        await embeddedFixtureSource(db, file, interrupted);
      const activities = createMediaFileActivities(file.context);
      const staged = await activities.inspectAndStageMedia(interrupted.input);
      if (staged.status !== "staged")
        throw new Error(
          `Compensation fixture staging failed: ${JSON.stringify(staged)}`,
        );
      const checkpoint = file.context.checkpoint;
      const failure = new Error(
        "Synthetic database rollback after durable publication ACK",
      );
      const stopPhase =
        options.stopAt === "sidecar_link"
          ? "publication-effect-ack:move_link"
          : options.stopAt === "sidecar"
            ? "publication-effect-ack:journal_complete"
            : "publication-before-commit";
      file.context.checkpoint = async (phase) => {
        await checkpoint(phase);
        if (phase === stopPhase) throw failure;
      };
      try {
        if (options.processKill === true || options.unacknowledgedKill === true)
          await killPublicationChild(
            db,
            file,
            interrupted.input,
            options.unacknowledgedKill === true
              ? "sidecar-syscall-before-ack"
              : stopPhase,
          );
        else {
          await activities.promoteMediaFiles(interrupted.input);
          throw new Error("Interrupted publication unexpectedly completed");
        }
      } catch (error) {
        if (error !== failure) throw error;
      } finally {
        file.context.checkpoint = checkpoint;
      }
      beforeRestore = {
        attempt: await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: interrupted.attempt.id },
        }),
        transition: await db.mediaPublicationTransition.findUniqueOrThrow({
          where: { attemptId: interrupted.attempt.id },
        }),
      };
    };
    let setup = await nativeStorageFixture(db, cipher, "seeding", {
      ...(options.omitLegacySubtitlePolicy === undefined
        ? {}
        : { omitLegacySubtitlePolicy: options.omitLegacySubtitlePolicy }),
      fileFactory: async () => {
        const file = await (options.fileFactory?.() ??
          mappedPublicationFixture(db));
        directory = file.directory;
        return file;
      },
      ...(options.nativePredecessor === true
        ? {}
        : { beforeRestore: interrupt }),
    });
    const priorNativeReceipt =
      options.nativePredecessor === true
        ? await grantNativePredecessor(db, setup)
        : null;
    const settledReplacement =
      options.abandonedReplacement === true
        ? await abandonNativeReplacement(db, cipher, setup)
        : null;
    if (priorNativeReceipt !== null) {
      if (setup.file.media.kind === "movie")
        await chooseCurrentTestMovieEdition(db, {
          requestId: setup.file.request.id,
          access: { serverMachineId: "server", movieSectionId: "1" },
        });
      await interrupt(setup);
      setup = await restoreNativeFixtureAgain(db, setup);
    }
    if (interrupted === undefined || beforeRestore === undefined)
      throw new Error("Interrupted fixture attempt missing");
    const successorObservation = {
      ...setup.observation,
      hash: createHash("sha1").update(interrupted.attempt.id).digest("hex"),
      infohash_v1: createHash("sha1")
        .update(interrupted.attempt.id)
        .digest("hex"),
      infohash_v2: "",
      save_path: `/downloads/media/${interrupted.attempt.id}`,
      content_path: `/downloads/media/${interrupted.attempt.id}/video.mkv`,
    };
    await db.torrent.update({
      where: { id: z.uuid().parse(interrupted.attempt.torrentId) },
      data: {
        state: "seeding",
        infoHash: successorObservation.infohash_v1,
        qbittorrentId: successorObservation.hash,
        observation: { torrent: successorObservation },
      },
    });
    const originalObserverContext: NativeCompensationObserverContext = {
      ...setup.prior.context,
      plex: {
        ...setup.prior.context.plex,
        activeSessions: () => Promise.resolve([]),
      },
      qbittorrent: {
        ...setup.prior.context.qbittorrent,
        listAll: () =>
          Promise.resolve([setup.observation, successorObservation]),
      },
      describeWorkflow: () => Promise.resolve(null),
    };
    if (setup.file.media.kind === "episode")
      await configureArchiveTvPlex(db, originalObserverContext, {
        mediaIds: setup.published.entry.mediaIds,
        canonicalPath: setup.canonicalPath,
        sizeBytes: setup.asset.sizeBytes,
      });
    const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: interrupted.attempt.id },
    });
    const service = new PrismaNativeCompensation(
      db,
      originalObserverContext.describeWorkflow,
    );
    const command = await service.prepare(
      setup.prior.actor,
      crypto.randomUUID(),
      {
        lifecycleKind: "publication_compensation",
        restoreOperationId: setup.restore.id,
        recoveryEpoch: setup.runtime.recoveryEpoch,
        runtimeVersion: setup.runtime.version,
        activation: "activate",
        transitionId: transition.id,
      },
    );
    const input = {
      planId: z.uuid().parse(command.nativeRecoveryId),
      operationId: z.uuid().parse(command.operationId),
    };
    const storedPlan = await db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: input.planId },
    });
    const network = await compensationNativePlexFixture(
      originalObserverContext,
      NativeCompensationScopeSchema.parse(storedPlan.scope),
    );
    const observerContext = network.context;
    const activities = createNativeCompensationFileActivities(
      setup.context,
      testCompensationExecution,
    );
    const prepare = async () => {
      await createNativePlexObserver(observerContext)(
        input,
        bindingTestExecution(),
      );
      await activities.prepareNativeCompensationFiles(input);
    };
    const apply = async (): Promise<NativeCompensationActivityInput> => {
      const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: input.planId },
      });
      const planHash = z.string().parse(plan.planHash);
      const approved = await service.apply(
        setup.prior.actor,
        crypto.randomUUID(),
        plan.id,
        {
          expectedVersion: plan.version,
          planHash,
          recoveryEpoch: plan.recoveryEpoch,
          runtimeVersion: plan.runtimeVersion,
          acknowledgeCompensationOnly: true,
          acknowledgeRecoveryHolds: true,
          acknowledgeSuccessorRetained: true,
        },
      );
      const approval = {
        planId: plan.id,
        operationId: z.uuid().parse(approved.operationId),
        planHash,
      };
      await createNativePlexObserver(observerContext)(
        { planId: approval.planId, operationId: approval.operationId },
        bindingTestExecution(),
      );
      await activities.applyNativeCompensationFiles(approval);
      const continuation =
        await db.nativePublicationCompensationContinuation.findFirstOrThrow({
          where: { receipt: { planId: plan.id } },
        });
      return {
        schemaVersion: 1,
        continuationId: continuation.id,
        operationId: z.uuid().parse(continuation.coordinatorOperationId),
        recoveryEpoch: continuation.recoveryEpoch,
      };
    };
    const observe = (activity: NativeCompensationActivityInput) =>
      observePairedCompensationExecution(
        observerContext,
        activity,
        bindingTestExecution(),
      );
    return {
      ...setup,
      interrupted,
      transition,
      beforeRestore,
      priorNativeReceipt,
      settledReplacement,
      observerContext,
      wire: network.wire,
      service,
      activities,
      input,
      prepare,
      apply,
      observe,
    };
  } catch (error) {
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
