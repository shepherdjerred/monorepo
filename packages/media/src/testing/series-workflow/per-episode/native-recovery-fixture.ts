import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createPerEpisodeMultiSeasonFixture } from "./fixture.ts";
import {
  createAcquisitionNetworkFacet,
  createAcquisitionFileFacet,
} from "#automation/acquisition-management/facets.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
  type WorkflowStart,
} from "#automation/store.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { createSeriesPackNativeCompensationFileFacetV1 } from "#automation/native-compensation/series-pack/facet.ts";
import { createSeriesPackNativeCompensationNetworkFacetV1 } from "#migration/native-compensation/series-pack/facet.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PlexClient } from "#integrations/plex.ts";
import { perEpisodeNativeObserverV1 } from "./native-observer.ts";
import { perEpisodeCanonicalExclusionV1 } from "./canonical-storage.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { nativeSeriesPackCaptionEvidenceV1 } from "./native-caption-evidence.ts";
import { nativeSeriesPackHouseholdV1 } from "./native-household.ts";
import { nativeSeriesPackTimezonePoolsV1 } from "./native-timezones.ts";
import { createSeedingNetworkFacet } from "#automation/seeding/facet.ts";
import { SeriesPackNativeSeedCommandV1Schema } from "#shared/native-recovery/series-pack/source.ts";
import { nativeSeriesPackRequesterWatchV1 } from "./native-requester-watch.ts";
import { nativeSeriesPackRetryCommandsV1 } from "./native-retry.ts";
import type { Database } from "#infrastructure/database.ts";
import { refreshWriterLease } from "#infrastructure/handoff/lease.ts";
import { refreshStorageAuthorities } from "#infrastructure/handoff/storage-observer.ts";

type Interrupted = { operationId: string; attemptId: string };
/** Both imports, original acquisition/outbox and WAL are genuine. The Temporal
 * test binds actual stop/describe ports; this fixture never fabricates a closed
 * Workflow or a completed forward batch that rolled back with its transaction. */
export async function createPerEpisodeNativeRecoveryFixtureV1(
  registerClose?: (close: () => Promise<void>) => void,
) {
  const startedAt = performance.now();
  const progress = (stage: string) =>
    Bun.write(
      Bun.stdout,
      `Actual native pack checkpoint: ${JSON.stringify({ stage, elapsedMs: Math.round(performance.now() - startedAt) })}\n`,
    );
  const cluster = await startMediaTestPostgres();
  await progress("postgres_ready");
  const db = cluster.database;
  const directories: string[] = [];
  let clusterClose: Promise<void> | undefined;
  let closePools: (() => Promise<void>) | undefined;
  const close = async () => {
    const failures = [];
    try {
      await closePools?.();
    } catch (error) {
      failures.push(error);
    }
    try {
      clusterClose ??= cluster.close();
      await clusterClose;
    } catch (error) {
      failures.push(error);
    }
    for (const directory of directories) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Owned native fixture did not close");
  };
  registerClose?.(close);
  try {
    const original = await movieVideoFixture(1280);
    await progress("original_video_encoded");
    const upgrade = await movieVideoFixture(1920, undefined, {
      bitrateKbps: 160_000,
    });
    await progress("upgrade_video_encoded");
    const f = await createPerEpisodeMultiSeasonFixture(
      db,
      (directory) => directories.push(directory),
      { original, upgrade },
      { canonicalStorage: true, initialCaptionSidecars: true },
    );
    await progress("initial_24_videos_48_sidecars_approved");
    const pools = await nativeSeriesPackTimezonePoolsV1(cluster.url);
    closePools = pools.close;
    await progress("actual_review_Los_Angeles_serving_Tokyo_pools_verified");
    const interrupted = Promise.withResolvers<Interrupted>();
    const settled = Promise.withResolvers<undefined>();
    let stop: ((input: Interrupted) => Promise<void>) | null = null;
    let describe: MediaAutomationContext["describeWorkflow"] | null = null;
    let active: Interrupted | null = null;
    let entered = false;
    const failure = new Error(
      "Synthetic coordinator crash after actual durable native publication ACKs",
    );
    const checkpoint = f.files.checkpoint;
    const observedCheckpoints = new Set<string>();
    const timedPhases = new Set([
      "series-pack-publication-authorization",
      "series-pack-publication-preparation-before-commit",
      "series-pack-publication-intent-before-commit",
      "series-pack-publication-physical-before-commit",
      "series-pack-native-compensation-measured",
      "series-pack-native-compensation-before-commit",
    ]);
    f.files.checkpoint = async (phase) => {
      await checkpoint(phase);
      if (timedPhases.has(phase) && !observedCheckpoints.has(phase)) {
        observedCheckpoints.add(phase);
        await progress(phase);
      }
      if (phase !== "series-pack-publication-physical-before-commit") return;
      if (entered) throw failure;
      if (active === null || stop === null)
        throw new Error(
          "Actual interruption ports were not bound before first native work",
        );
      entered = true;
      try {
        await stop(active);
      } catch (error) {
        interrupted.reject(error);
        throw error;
      }
      interrupted.resolve(active);
      throw failure;
    };
    const baseFiles = createAcquisitionFileFacet(f.files);
    const fileAcquisition = {
      ...baseFiles,
      publishSeriesPackMembersV1: async (
        ...args: Parameters<typeof baseFiles.publishSeriesPackMembersV1>
      ) => {
        active = {
          operationId: args[0].operationId,
          attemptId: args[0].attemptId,
        };
        try {
          return await baseFiles.publishSeriesPackMembersV1(...args);
        } catch (error) {
          if (entered) settled.resolve(undefined);
          throw error;
        } finally {
          active = null;
        }
      },
    };
    const sessionClient = new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token: "synthetic",
        clientIdentifier: "synthetic",
      },
      (url) => {
        if (url.pathname !== "/status/sessions")
          throw new Error("Unexpected synthetic native playback route");
        return Promise.resolve(
          Response.json({ MediaContainer: { size: 0, Metadata: [] } }),
        );
      },
    );
    f.wire.plex.activeSessions = (signal) =>
      sessionClient.activeSessions(signal);
    const userPlex = await nativeSeriesPackRequesterWatchV1(f.context, f.user);
    const context = {
      ...f.context,
      userPlex,
      observer: perEpisodeNativeObserverV1(f),
      expectedServerMachineId: "fixture-server",
      permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
      describeWorkflow: (workflowId: string) => {
        if (describe === null)
          throw new Error(
            "Native recovery needs the actual Temporal describe port",
          );
        return describe(workflowId);
      },
    };
    const nativeFiles = createSeriesPackNativeCompensationFileFacetV1({
      files: { ...f.files, db: pools.review },
      workerPodUid: "files-pod-uid",
    });
    const reviewNetwork = createSeriesPackNativeCompensationNetworkFacetV1({
      ...context,
      db: pools.review,
    });
    const servingNetwork = createSeriesPackNativeCompensationNetworkFacetV1({
      ...context,
      db: pools.serving,
    });
    const nativeNetwork = {
      ...reviewNetwork,
      publishSeriesPackNativeCompensationV1:
        servingNetwork.publishSeriesPackNativeCompensationV1,
    };
    const owner = f.network.actor;
    const service = new PrismaNativeRecovery(
      pools.review,
      context.describeWorkflow,
    );
    let originalLiteral: { transition: string; attempt: string } | null = null;
    return {
      db,
      owner,
      mediaIds: f.ids,
      operationId: f.input.operationId,
      originalAssetIds: f.originalAssetIds,
      acquisition: createAcquisitionNetworkFacet(f.context),
      fileAcquisition,
      ...createPlexRuntimeFacets(context, () => Promise.resolve(false)),
      nativeFiles,
      nativeNetwork,
      seeding: createSeedingNetworkFacet({ ...context, db: pools.serving }),
      sourceRatio: (ratio: number) => {
        f.wire.control.allowSourceRemoval = true;
        f.wire.control.ratio = ratio;
      },
      sourceRemovals: () => f.wire.removals(),
      refreshSourceAuthority: () => refreshSource(db, context.observer),
      originalSeedInput: async (torrentId: string) => {
        const operation = await db.operation.findUniqueOrThrow({
          where: { idempotencyKey: `seed:${torrentId}` },
        });
        return {
          operationId: operation.id,
          torrentId,
          payloadHash: identityHash(operation.payload),
        };
      },
      nativeSourceInput: async (continuationId: string) => {
        const operation = await db.operation.findFirstOrThrow({
          where: {
            kind: "maintain_torrent",
            payload: {
              path: ["seriesPackNativeSourceV1", "continuationId"],
              equals: continuationId,
            },
          },
          include: { outbox: true },
        });
        const command = SeriesPackNativeSeedCommandV1Schema.parse(
          operation.payload,
        );
        const outbox = operation.outbox;
        if (outbox === null || outbox.availableAt.getTime() > Date.now())
          throw new Error(
            "Actual Tokyo native source outbox is not immediately eligible",
          );
        return {
          operationId: command.operationId,
          torrentId: command.torrentId,
        };
      },
      household: nativeSeriesPackHouseholdV1(pools.review, {
        owner,
        requester: f.user,
      }),
      nativeDetail: (id: string) => service.detail(owner, id),
      nativeInventory: () => service.compensationInventory(owner),
      ...nativeSeriesPackRetryCommandsV1(service, pools.review, owner),
      interruptionRequested: () => entered,
      interrupted: interrupted.promise,
      settled: settled.promise,
      bindTemporal: (ports: {
        stop: (input: Interrupted) => Promise<void>;
        describe: MediaAutomationContext["describeWorkflow"];
      }) => {
        if (stop !== null || describe !== null)
          throw new Error(
            "Actual original Temporal ports can only be bound once",
          );
        stop = ports.stop;
        describe = ports.describe;
      },
      dispatch: (start: WorkflowStarter, caseDeadline: number) =>
        dispatchNativeFixtureOutbox(db, start, caseDeadline),
      roleCommand: (start: WorkflowStart) =>
        start.input["operationId"] === f.input.operationId,
      finishMediaOperation: createOutboxActivities(db, () =>
        Promise.reject(new Error("Completion cannot dispatch")),
      ).finishMediaOperation,
      restoreAndPrepare: async (input: Interrupted) => {
        await settled.promise;
        await progress("restore_observe_begin");
        const before = await db.mediaPublicationTransition.findUniqueOrThrow({
          where: { attemptId: input.attemptId },
        });
        const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: input.attemptId },
        });
        if (before.outcome !== null || before.birthEpoch !== 0)
          throw new Error(
            "Actual original publication was not interrupted before DB outcome",
          );
        originalLiteral = {
          transition: identityHash(nativeJson(before)),
          attempt: identityHash(nativeJson(attempt)),
        };
        const recoveryId = crypto.randomUUID();
        const restore = await prepareMediaRestore(db, {
          recoveryId,
          expectedEpoch: 0,
          reason: "Actual interrupted twenty-four-member native test recovery",
        });
        await progress("restore_observe_committed");
        const operation = await db.operation.findUniqueOrThrow({
          where: { idempotencyKey: `restore-observe:${recoveryId}` },
        });
        await perEpisodeCanonicalExclusionV1(f.files, owner.id);
        const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const prepared = await service.prepareCompensation(
          owner,
          crypto.randomUUID(),
          {
            lifecycleKind: "publication_compensation",
            restoreOperationId: operation.id,
            recoveryEpoch: restore.recoveryEpoch,
            runtimeVersion: runtime.version,
            activation: "activate",
            transitionId: before.id,
          },
        );
        return {
          planId: z.uuid().parse(prepared.nativeRecoveryId),
          operationId: z.uuid().parse(prepared.operationId),
        };
      },
      approve: async (planId: string) => {
        const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id: planId },
        });
        const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const applied = await service.apply(
          owner,
          crypto.randomUUID(),
          planId,
          {
            expectedVersion: plan.version,
            planHash: z.string().parse(plan.planHash),
            recoveryEpoch: runtime.recoveryEpoch,
            runtimeVersion: runtime.version,
            acknowledgeCompensationOnly: true,
            acknowledgeRecoveryHolds: true,
            acknowledgeSuccessorRetained: true,
          },
        );
        return {
          planId,
          operationId: z.uuid().parse(applied.operationId),
          planHash: z.string().parse(plan.planHash),
        };
      },
      effectInput: async (planId: string) => {
        const row =
          await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
            where: { id: planId },
          });
        return {
          schemaVersion: 1 as const,
          continuationId: row.id,
          operationId: z.uuid().parse(row.coordinatorOperationId),
          recoveryEpoch: row.recoveryEpoch,
        };
      },
      evidence: async () => {
        const coverage = await db.assetCoverage.findMany({
          where: { mediaId: { in: f.ids }, current: true, edition: "default" },
          include: { asset: true },
          orderBy: { mediaId: "asc" },
        });
        const transition = await db.mediaPublicationTransition.findFirst({
          where: { attempt: { mediaIds: { hasSome: f.ids } } },
        });
        const attempt =
          transition === null
            ? null
            : await db.acquisitionAttempt.findUniqueOrThrow({
                where: { id: transition.attemptId },
              });
        return {
          ...(await nativeSeriesPackCaptionEvidenceV1(f)),
          coverage,
          hashes: await Promise.all(
            coverage.map((row) =>
              sha256File(workerFilePath(f.files, row.asset.path)),
            ),
          ),
          transition,
          attempt,
          originalLiteral,
          originalUntouched:
            originalLiteral === null
              ? null
              : transition !== null &&
                attempt !== null &&
                identityHash(nativeJson(transition)) ===
                  originalLiteral.transition &&
                identityHash(nativeJson(attempt)) === originalLiteral.attempt,
          continuations:
            await db.nativePublicationCompensationContinuation.findMany(),
          sourceAdds: f.wire.additions(),
          receipts: await db.mediaHandoffReceipt.findMany({
            where: { id: { in: f.receipts.map((row) => row.receiptId) } },
            orderBy: { id: "asc" },
          }),
          holds: await db.recoveryHold.findMany({
            where: { mediaId: { in: f.ids }, edition: "default" },
          }),
          forward:
            transition === null
              ? []
              : await db.operation.findMany({
                  where: {
                    kind: "publish_series_pack_members_v1",
                    targetId: transition.attemptId,
                  },
                }),
        };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Observe current platform authority for a new phase, retaining all original
 * approval receipts and finite evidence lifetimes across cold worker startup. */
async function refreshSource(
  db: Database,
  observer: ReturnType<typeof perEpisodeNativeObserverV1>,
) {
  await refreshWriterLease(db, () => observer.observe());
  await refreshStorageAuthorities(db, observer);
}

/** Imports leave multiple scheduler pages; slow runs can make prior failed
 * starts due again. Drive real bounded pages without rewriting queue clocks. */
async function dispatchNativeFixtureOutbox(
  db: Database,
  start: WorkflowStarter,
  caseDeadline: number,
) {
  const dueAtStart = await db.outboxCommand.count({
    where: { dispatchedAt: null, availableAt: { lte: new Date() } },
  });
  const dispatcher = createOutboxActivities(db, start);
  let inspected = 0;
  let deferred = 0;
  let passes = 0;
  while (inspected < dueAtStart && Date.now() < caseDeadline) {
    const result = await dispatcher.dispatchMediaOutbox();
    passes++;
    deferred += result.deferred;
    inspected += result.dispatched + result.deferred;
    if (result.dispatched > 0 || result.deferred === 0)
      return { dispatched: result.dispatched, deferred, passes, dueAtStart };
  }
  return { dispatched: 0, deferred, passes, dueAtStart };
}
