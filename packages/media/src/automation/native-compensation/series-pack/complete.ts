import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { PublicationEffectState } from "#automation/publication-proof/effect-state.ts";
import type { SeriesPackNativePhaseV1 } from "#infrastructure/native-compensation/series-pack/phase.ts";
import { SeriesPackNativeCompletionV2Schema } from "#shared/native-recovery/series-pack/runtime.ts";
import { reserveSeriesPackNativeSqlV1 } from "#infrastructure/native-compensation/series-pack/sql-budget.ts";
import { settleSeriesPackInterruptedV1 } from "#infrastructure/native-compensation/series-pack/interrupted.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { writeSeriesPackNativeBindingsV1 } from "./write-acks.ts";

/** Whole actual write-ACK and settlement closure in the one held effect TX. */
export async function completeSeriesPackNativeCompensationV1(
  tx: Prisma.TransactionClient,
  phase: SeriesPackNativePhaseV1,
  input: { context: PublicationContext; state: PublicationEffectState },
) {
  if (phase.transaction !== tx || phase.proof === null)
    throw new Error(
      "Native pack completion requires the actual current effect phase",
    );
  await phase.assertCurrent();
  phase.freshness.assertActive();
  const { record } = phase;
  const scope = record.descriptor.scope;
  reserveSeriesPackNativeSqlV1(phase.budget, scope, "complete");
  const written = await writeSeriesPackNativeBindingsV1(
    tx,
    input.context,
    scope,
  );
  const settlement = await settleSeriesPackInterruptedV1(
    tx,
    record.graph,
    scope.interruptedWork,
  );
  if (
    (await tx.recoveryHold.count({
      where: {
        edition: "default",
        mediaId: { in: record.row.mediaIds },
        recoveryEpoch: record.row.recoveryEpoch,
        releasedAt: null,
      },
    })) !== record.row.mediaIds.length
  )
    throw new Error(
      "Native pack completion cannot release genuine recovery holds",
    );
  await tx.mediaItem.updateMany({
    where: { id: { in: record.row.mediaIds } },
    data: {
      availability: "importing",
      version: { increment: 1 },
    },
  });
  await mirrorDefaultAvailability(tx, record.row.mediaIds, "importing");
  const completion = SeriesPackNativeCompletionV2Schema.parse({
    schemaVersion: 2,
    protocol: "series_pack_publication_v3",
    continuationId: record.row.id,
    receiptId: record.row.receiptId,
    descriptorHash: record.row.descriptorHash,
    recoveryEpoch: record.row.recoveryEpoch,
    transition: scope.transition,
    executionPlex: phase.proof.ref,
    compensationEffects: input.state.refs.slice(
      record.descriptor.approvedFileEvidence.acknowledgedEffects.length,
    ),
    predecessorBindings: written.bindings,
    retainedArtifacts: written.retained,
    journals: [...input.state.journals.values()],
    settlement,
    completedAt: new Date().toISOString(),
  });
  const changed = await tx.nativePublicationCompensationContinuation.updateMany(
    {
      where: {
        id: record.row.id,
        version: record.row.version,
        coordinatorOperationId: phase.input.operationId,
        descriptorHash: record.row.descriptorHash,
        receiptId: record.row.receiptId,
        recoveryEpoch: record.row.recoveryEpoch,
        completion: { equals: Prisma.DbNull },
      },
      data: {
        completion: z.record(z.string(), z.json()).parse(completion),
        state: "compensated",
        version: { increment: 1 },
      },
    },
  );
  if (changed.count !== 1)
    throw new Error("Native pack whole completion CAS changed");
  phase.freshness.assertActive();
  phase.close();
  return completion;
}
