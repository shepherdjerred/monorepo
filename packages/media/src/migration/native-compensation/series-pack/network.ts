import type { NativePlexContext } from "#migration/native-plex/producer.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { SeriesPackNativeCompensationScopeV3 } from "#shared/native-recovery/series-pack/scope.ts";
import {
  SeriesPackNativeNetworkEvidenceV3Schema,
  SeriesPackNativeAcquisitionClosedV1Schema,
} from "#shared/native-recovery/series-pack/evidence.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";
import {
  assertCanonicalIdentity,
  assertWritersQuiescent,
} from "#migration/native-network/evidence.ts";
import { observeNativeTorrents } from "#migration/native-network/torrents.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { observeSeriesPackNativeCompensationPlexV1 } from "./plex.ts";

export async function captureSeriesPackNativeNetworkV1(
  context: NativePlexContext,
  input: { planId: string; scope: SeriesPackNativeCompensationScopeV3 },
  execution: PlexBindingExecution,
  freshness: PlexBindingFreshness,
) {
  const run = async <T>(work: () => Promise<T>) => {
    execution.assertActive();
    freshness.assertActive();
    const value = await work();
    execution.assertActive();
    freshness.assertActive();
    return value;
  };
  const capturedAt = new Date().toISOString();
  const signal = AbortSignal.any([
    execution.signal,
    AbortSignal.timeout(Math.max(1, freshness.expiresAtMs - Date.now())),
  ]);
  const quiescence = QuiescenceEvidenceSchema.parse(
    await run(() => context.observer.observe(signal)),
  );
  assertWritersQuiescent(quiescence);
  const mounts = CanonicalMountEvidenceSchema.parse(
    await run(() => context.observer.observeCanonicalMounts(signal)),
  );
  assertCanonicalIdentity(mounts, input.scope.storageRoots);
  const configured = await run(() => context.permittedSections());
  const plex = await run(() =>
    observeSeriesPackNativeCompensationPlexV1(context, input.scope, signal),
  );
  await run(() => context.qbittorrent.login(signal));
  const torrents = await run(() =>
    observeNativeTorrents({
      torrents: input.scope.torrents,
      qbittorrent: context.qbittorrent,
      signal,
    }),
  );
  const operationId =
    input.scope.publication.intent.seriesPackPublication.coordinatorOperationId;
  const workflowId = `media-operation-${operationId}`;
  const description = await run(() => context.describeWorkflow(workflowId));
  if (description === null)
    throw new NativeCompensationProtection(
      "compensation_original_workflow_not_closed",
    );
  const closed = ClosedCoordinatorObservationSchema.safeParse({
    operationId,
    workflowId,
    runId: description.runId,
    status: description.status,
    observedAt: new Date().toISOString(),
  });
  if (!closed.success)
    throw new NativeCompensationProtection(
      "compensation_original_workflow_not_closed",
    );
  const acquisitionWorkflowId = `media-acquire-${input.scope.publication.intent.attemptId}`;
  const acquisition = await run(() =>
    context.describeWorkflow(acquisitionWorkflowId),
  );
  const acquisitionClosed = SeriesPackNativeAcquisitionClosedV1Schema.safeParse(
    {
      operationId,
      attemptId: input.scope.publication.intent.attemptId,
      workflowId: acquisitionWorkflowId,
      runId: acquisition?.runId,
      status: acquisition?.status,
      observedAt: new Date().toISOString(),
    },
  );
  if (acquisition === null || !acquisitionClosed.success)
    throw new NativeCompensationProtection(
      "compensation_original_acquisition_not_closed",
    );
  const expiresAtMs = Math.min(
    freshness.expiresAtMs,
    Date.parse(quiescence.expiresAt),
    Date.parse(mounts.expiresAt),
  );
  freshness.assertActive();
  return SeriesPackNativeNetworkEvidenceV3Schema.parse({
    schemaVersion: 3,
    lifecycleKind: "publication_compensation",
    protocol: "series_pack_publication_v3",
    planId: input.planId,
    recoveryEpoch: input.scope.request.recoveryEpoch,
    capturedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    quiescence,
    mounts,
    access: {
      serverMachineId: context.expectedServerMachineId,
      sectionId: configured.series,
      sectionType: "show",
    },
    plex,
    torrents,
    originalWorkflowClosed: closed.data,
    originalAcquisitionClosed: acquisitionClosed.data,
    previousWorkflowClosed: null,
  });
}
