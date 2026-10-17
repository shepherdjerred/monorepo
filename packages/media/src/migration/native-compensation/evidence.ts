import type { NativeQuarantineObserverContext } from "#migration/native-network/quarantine.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import {
  NativeCompensationNetworkEvidenceSchema,
  type NativeCompensationScope,
} from "#shared/native-recovery/compensation.ts";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import {
  assertCanonicalIdentity,
  assertWritersQuiescent,
} from "#migration/native-network/evidence.ts";
import { observeNativeTorrents } from "#migration/native-network/torrents.ts";
import { assertCompensationActive, compensationAwait } from "./execution.ts";
import { observeCompensationPlex } from "./plex.ts";

export type NativeCompensationObserverContext =
  NativeQuarantineObserverContext &
    Pick<MediaAutomationContext, "describeWorkflow">;

export async function observeCompensationEvidence(
  context: NativeCompensationObserverContext,
  input: {
    planId: string;
    recoveryEpoch: number;
    scope: NativeCompensationScope;
  },
  execution: NativeCompensationExecutionContext,
) {
  assertCompensationActive(execution);
  const capturedAt = new Date();
  const signal = AbortSignal.any([
    execution.signal,
    AbortSignal.timeout(60_000),
  ]);
  const roots = await compensationAwait(execution, () =>
    assertNativeStorageRoots(context.db, input.scope.storageRoots),
  );
  const quiescence = QuiescenceEvidenceSchema.parse(
    await compensationAwait(execution, () => context.observer.observe(signal)),
  );
  assertWritersQuiescent(quiescence);
  const mounts = CanonicalMountEvidenceSchema.parse(
    await compensationAwait(execution, () =>
      context.observer.observeCanonicalMounts(signal),
    ),
  );
  assertCanonicalIdentity(mounts, roots);
  const [plex, torrents] = await compensationAwait(execution, () =>
    Promise.all([
      observeCompensationPlex(context, input.scope, signal),
      observeNativeTorrents({
        torrents: input.scope.torrents,
        qbittorrent: context.qbittorrent,
        signal,
      }),
    ]),
  );
  signal.throwIfAborted();
  const previousWorkflowClosed = await previousCoordinator(
    context,
    input.scope,
    execution,
  );
  return NativeCompensationNetworkEvidenceSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "publication_compensation",
    planId: input.planId,
    recoveryEpoch: input.recoveryEpoch,
    capturedAt: capturedAt.toISOString(),
    expiresAt: new Date(
      Math.min(
        Date.parse(quiescence.expiresAt),
        Date.parse(mounts.expiresAt),
        capturedAt.getTime() + 90_000,
      ),
    ).toISOString(),
    quiescence,
    mounts,
    plex,
    torrents,
    previousWorkflowClosed,
  });
}

async function previousCoordinator(
  context: NativeCompensationObserverContext,
  scope: NativeCompensationScope,
  execution: NativeCompensationExecutionContext,
) {
  if (scope.previousCompensation === null) return null;
  const operationId = scope.previousCompensation.coordinatorOperationId;
  const workflowId = `media-operation-${operationId}`;
  const observed = await compensationAwait(execution, () =>
    context.describeWorkflow(workflowId),
  );
  const status = ClosedCoordinatorObservationSchema.shape.status.safeParse(
    observed?.status,
  );
  if (observed === null || !status.success || observed.runId.length === 0)
    throw new NativeCompensationProtection(
      "compensation_previous_workflow_not_closed",
    );
  return ClosedCoordinatorObservationSchema.parse({
    operationId,
    workflowId,
    runId: observed.runId,
    status: status.data,
    observedAt: new Date().toISOString(),
  });
}
