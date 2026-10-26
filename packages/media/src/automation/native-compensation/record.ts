import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PairedNativeProof } from "#automation/native-recovery/plex-proof.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { CompensationExecutionDiscovery } from "#infrastructure/native-compensation/execution/discovery.ts";
import { persistCompensationDiscoveryExecution } from "#infrastructure/native-compensation/execution/discovery-check.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import {
  prepareMeasuredPublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "#automation/publication-proof/recording.ts";
import {
  captureCompensationAuthority,
  assertCompensationAuthorityCurrent,
} from "./authority.ts";
import {
  compensationDeadline,
  type CompensationFileContext,
} from "./execution.ts";
import type { measureCompensationExecution } from "./measurement.ts";

/** Every root can only reduce the original clock, including the deferred SQL deadline. */
export async function compensationRootFreshness(
  tx: Prisma.TransactionClient,
  context: CompensationFileContext,
  input: {
    activity: NativeCompensationActivityInput;
    execution: PlexBindingExecution;
    plex: PairedNativeProof;
    kinds: readonly ("movies" | "tv")[];
  },
) {
  let freshness = input.plex.freshness;
  for (const libraryKind of input.kinds) {
    freshness.assertActive();
    const deadline = await publicationAuthorityDeadline(tx, context.files, {
      libraryKind,
      recoveryEpoch: input.activity.recoveryEpoch,
    });
    freshness = plexBindingFreshness({
      observed: input.execution.observed,
      expiresAtMs: Math.min(freshness.expiresAtMs, deadline.expiresAtMs),
      guards: [freshness, deadline],
    });
    await bindPlexTransactionDeadline(tx, freshness);
    freshness.assertActive();
  }
  return freshness;
}

/** First full authority phase. Only measured data and original guards survive this TX. */
export async function recordCompensationMeasurement(
  initial: CompensationFileContext,
  input: {
    activity: NativeCompensationActivityInput;
    execution: PlexBindingExecution;
    discovery: CompensationExecutionDiscovery;
    measured: Awaited<ReturnType<typeof measureCompensationExecution>>;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { activity, execution, discovery, measured, budget } = input;
  return await initial.files.db.$transaction(
    async (tx) => {
      const captured = await captureCompensationAuthority(
        tx,
        initial,
        activity,
        {
          observed: execution.observed,
          freshness: plexBindingFreshness({
            observed: execution.observed,
            expiresAtMs: Math.min(execution.expiresAtMs, discovery.expiresAtMs),
            guards: [execution],
          }),
          budget,
          discovery,
          execution,
        },
      );
      if (captured === null) return null;
      const freshness = await compensationRootFreshness(tx, initial, {
        activity,
        execution,
        plex: captured.plex,
        kinds: [
          ...new Set(measured.plan.map((entry) => entry.libraryKind)),
        ].sort(),
      });
      const plex = { ...captured.plex, freshness };
      const deadline = compensationDeadline(
        initial,
        captured.authority.network,
      );
      const assertActive = () => {
        execution.assertActive();
        deadline();
        freshness.assertActive();
      };
      const assertCurrent = async () => {
        await assertCompensationAuthorityCurrent(
          tx,
          initial,
          plex,
          captured.phase,
        );
        assertActive();
      };
      const prepared = await measured.seal({ assertActive, assertCurrent });
      const { context } = prepared;
      const stores = await prepareMeasuredPublicationStores(context.files, {
        transitionId: measured.intent.transitionId,
        continuationId: activity.continuationId,
        plan: measured.plan,
        measurements: measured.measurements,
        authority: { assertActive, assertCurrent },
      });
      await context.files.checkpoint(
        "native-compensation-namespace-initialized",
      );
      assertActive();
      const recording = publicationRecording(
        context.files,
        measured.intent,
        stores,
        {
          inverse: { continuationId: activity.continuationId },
          acknowledged: measured.allRecords.filter(
            (record) => record.continuationId !== activity.continuationId,
          ),
        },
      );
      const approved = captured.authority.descriptor.approvedFileEvidence;
      const executionEvidence = {
        schemaVersion: 1 as const,
        continuationId: activity.continuationId,
        descriptorHash: captured.authority.descriptorHash,
        recoveryEpoch: activity.recoveryEpoch,
        transition: captured.authority.descriptor.scope.transition,
        effectPrefixHash: approved.effectPrefixHash,
        participants: approved.participants,
      };
      const operations = recording.operations(assertCurrent);
      const advanced = await withPublicationPaths(
        context.files,
        measured.plan,
        operations,
        async () => {
          await recording.assertCurrent();
          await prepared.assertCurrent();
          await assertCurrent();
          const next = await persistCompensationDiscoveryExecution(
            tx,
            {
              activity,
              executionEvidence,
            },
            captured.phase,
            { discovery, execution, freshness, budget },
          );
          assertActive();
          return next;
        },
      );
      assertActive();
      return { plex, context, stores, recording, discovery: advanced };
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
