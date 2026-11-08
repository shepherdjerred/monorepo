import type { NativePlexContext } from "#migration/native-plex/producer.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "#shared/native-recovery/series-pack/scope.ts";
import { SeriesPackNativeDescriptorV2Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import {
  SeriesPackNativeReviewV1Schema,
  type SeriesPackNativeReviewV1,
  type SeriesPackNativeActivityV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { loadSeriesPackNativeReviewPhaseV1 } from "#infrastructure/native-compensation/series-pack/review-phase.ts";
import { loadSeriesPackNativePhaseV1 } from "#infrastructure/native-compensation/series-pack/phase.ts";
import { seriesPackNativeNetworkIdentityV1 } from "#infrastructure/native-compensation/series-pack/plex-records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { captureSeriesPackNativeNetworkV1 } from "./network.ts";
import { persistSeriesPackNativeNetworkV1 } from "./persist.ts";
import { readSeriesPackNativeCompletedV1 } from "#infrastructure/native-compensation/series-pack/completed.ts";
import { readSeriesPackNativeReviewAckV1 } from "#infrastructure/native-compensation/series-pack/review-ack.ts";

async function currentRootExpiry(
  tx: Pick<
    Prisma.TransactionClient,
    "legacyWriterLease" | "mediaStorageAuthority"
  >,
  epoch: number,
) {
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const roots = await tx.mediaStorageAuthority.findMany({
    where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
  });
  const now = Date.now();
  if (
    roots.length !== 2 ||
    lease.revokedAt !== null ||
    lease.recoveryEpoch !== epoch ||
    lease.observedAt.getTime() > now ||
    lease.expiresAt.getTime() <= now ||
    roots.some(
      (row) =>
        row.revokedAt !== null ||
        row.recoveryEpoch !== epoch ||
        row.observedAt.getTime() > now ||
        row.expiresAt.getTime() <= now ||
        row.expiresAt.getTime() - row.observedAt.getTime() > 120_000,
    )
  )
    throw new NativeCompensationProtection(
      "compensation_storage_or_writer_expired",
    );
  return Math.min(
    lease.expiresAt.getTime(),
    ...roots.map((row) => row.expiresAt.getTime()),
  );
}

async function observe(
  context: NativePlexContext,
  input: SeriesPackNativeReviewV1 | SeriesPackNativeActivityV1,
  execution: PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
) {
  execution.assertActive();
  if (
    "planId" in input &&
    (await context.db.$transaction((tx) =>
      readSeriesPackNativeReviewAckV1(tx, input, budget),
    ))
  )
    return { status: "ready" as const, reason: null };
  if (
    "continuationId" in input &&
    (await context.db.$transaction((tx) =>
      readSeriesPackNativeCompletedV1(tx, input, budget),
    ))
  )
    return { status: "compensated" as const, reason: null };
  const original = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      execution.expiresAtMs,
      execution.observed.wall + 60_000,
    ),
    guards: [execution],
  });
  const continuation =
    "continuationId" in input
      ? await context.db.nativePublicationCompensationContinuation.findUniqueOrThrow(
          { where: { id: input.continuationId } },
        )
      : null;
  if (continuation !== null) budget.consume(1);
  const plan = await context.db.nativeRecoveryPlan.findUniqueOrThrow({
    where: {
      id:
        continuation?.id ??
        ("planId" in input ? input.planId : input.continuationId),
    },
  });
  budget.consume(1);
  const scope = SeriesPackNativeCompensationScopeV3Schema.parse(plan.scope);
  if (
    continuation !== null &&
    (identityHash(continuation.descriptor) !== continuation.descriptorHash ||
      identityHash(
        SeriesPackNativeDescriptorV2Schema.parse(continuation.descriptor).scope,
      ) !== identityHash(scope))
  )
    throw new Error(
      "Native pack observation lost its literal original descriptor",
    );
  const storageExpiry =
    continuation === null
      ? original.expiresAtMs
      : await currentRootExpiry(context.db, plan.recoveryEpoch);
  const before = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(original.expiresAtMs, storageExpiry),
    guards: [original],
  });
  const network = await captureSeriesPackNativeNetworkV1(
    context,
    { planId: plan.id, scope },
    execution,
    before,
  );
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(before.expiresAtMs, Date.parse(network.expiresAt)),
    guards: [before],
  });
  return context.db.$transaction(
    async (tx) => {
      freshness.assertActive();
      if ("continuationId" in input) {
        const phase = await loadSeriesPackNativePhaseV1(tx, input, budget, {
          freshness,
          observe: true,
        });
        if (phase.kind === "completed")
          return { status: "compensated" as const, reason: null };
        if (
          identityHash(phase.record.descriptor.scope) !== identityHash(scope) ||
          identityHash(seriesPackNativeNetworkIdentityV1(network)) !==
            phase.record.finished.networkIdentityHash ||
          (await currentRootExpiry(tx, plan.recoveryEpoch)) <
            freshness.expiresAtMs
        )
          throw new NativeCompensationProtection(
            "compensation_network_changed",
          );
        await phase.assertCurrent();
        await bindPlexTransactionDeadline(tx, freshness);
        await persistSeriesPackNativeNetworkV1(
          tx,
          {
            transaction: tx,
            plan: phase.record.row.receipt.plan,
            operation: phase.operation,
            scope: phase.record.descriptor.scope,
            continuation: phase.record.row,
          },
          network,
          {
            budget,
            freshness,
            startedAt: new Date(execution.observed.wall).toISOString(),
          },
        );
        phase.close();
      } else {
        const phase = await loadSeriesPackNativeReviewPhaseV1(
          tx,
          input,
          budget,
        );
        if (identityHash(phase.scope) !== identityHash(scope))
          throw new Error(
            "Native pack review scope changed during real observation",
          );
        await bindPlexTransactionDeadline(tx, freshness);
        await persistSeriesPackNativeNetworkV1(
          tx,
          { ...phase, continuation: null },
          network,
          {
            budget,
            freshness,
            startedAt: new Date(execution.observed.wall).toISOString(),
          },
        );
      }
      freshness.assertActive();
      return { status: "ready" as const, reason: null };
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

export async function observeSeriesPackNativeCompensationV1(
  context: NativePlexContext,
  raw: SeriesPackNativeReviewV1,
  execution: PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
): Promise<void> {
  execution.assertActive();
  await observe(
    context,
    SeriesPackNativeReviewV1Schema.parse(raw),
    execution,
    budget,
  );
}

export async function observeSeriesPackNativeCompensationExecutionV1(
  context: NativePlexContext,
  raw: SeriesPackNativeActivityV1,
  execution: PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
) {
  execution.assertActive();
  try {
    return await observe(
      context,
      NativeCompensationActivityInputSchema.parse(raw),
      execution,
      budget,
    );
  } catch (error) {
    execution.assertActive();
    if (error instanceof NativeCompensationProtection)
      return { status: "protected" as const, reason: error.reason };
    throw error;
  }
}
