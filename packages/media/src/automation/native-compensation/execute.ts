import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { publicationRecordStore } from "#filesystem/publication-proof/store.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import {
  persistCompensationExecution,
  commitNativeCompensation,
} from "#infrastructure/native-compensation/completion.ts";
import {
  preparePublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "#automation/publication-proof/recording.ts";
import { publicationAuthorityGuard } from "#automation/publication-proof/authority.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import { executePublicationInverse } from "#automation/publication-proof/inverse.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { compensationAuthority } from "./authority.ts";
import { captureCompensationProof } from "./proof.ts";
import {
  compensationDeadline,
  type CompensationFileContext,
} from "./execution.ts";
import { compensationCompletion } from "./complete.ts";

export async function executeNativeCompensation(
  initial: CompensationFileContext,
  activity: NativeCompensationActivityInput,
): Promise<void> {
  const db = initial.files.db;
  const authority = await db.$transaction((tx) =>
    compensationAuthority(tx, initial, activity),
  );
  if (authority.completion !== null) return;
  const plan = authority.descriptor.scope.intent.entries.map(
    (item) => item.entry,
  );
  for (const kind of [
    ...new Set(plan.map((entry) => entry.libraryKind)),
  ].sort())
    await publicationRecordStore(initial.files.roots[kind], {
      transitionId: authority.descriptor.scope.transition.transitionId,
      continuationId: activity.continuationId,
      assertActive: compensationDeadline(initial, authority.network),
      ...(initial.files.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: initial.files.verifyPlexExclusion }),
    });
  const prepared = await captureCompensationProof(
    initial,
    authority.descriptor.scope,
    authority.planId,
    activity.continuationId,
  );
  const { context } = prepared;
  const approved = authority.descriptor.approvedFileEvidence;
  const allRecords = prepared.evidence.acknowledgedEffects;
  if (
    snapshotHash(
      nativeJson(allRecords.slice(0, approved.acknowledgedEffects.length)),
    ) !== approved.effectPrefixHash ||
    allRecords
      .slice(approved.acknowledgedEffects.length)
      .some((record) => record.continuationId !== activity.continuationId)
  )
    throw new FileOperationConflict(
      "Compensation prefix no longer extends the exact owner review",
    );
  if (
    authority.execution === null &&
    (allRecords.length !== approved.acknowledgedEffects.length ||
      snapshotHash(nativeJson(prepared.evidence.participants)) !==
        snapshotHash(nativeJson(approved.participants)))
  )
    throw new FileOperationConflict(
      "Compensation effects lack durable execution identity",
    );
  const stores = await preparePublicationStores(context.files, {
    transitionId: prepared.intent.transitionId,
    continuationId: activity.continuationId,
    plan,
  });
  const recording = publicationRecording(
    context.files,
    prepared.intent,
    stores,
    {
      inverse: { continuationId: activity.continuationId },
      acknowledged: allRecords.filter(
        (record) => record.continuationId !== activity.continuationId,
      ),
    },
  );
  const assertActive = compensationDeadline(context, authority.network);
  const execution = {
    schemaVersion: 1 as const,
    continuationId: activity.continuationId,
    descriptorHash: authority.descriptorHash,
    recoveryEpoch: activity.recoveryEpoch,
    transition: authority.descriptor.scope.transition,
    effectPrefixHash: approved.effectPrefixHash,
    participants: approved.participants,
  };
  await db.$transaction(
    async (tx) => {
      assertActive();
      const current = await compensationAuthority(tx, context, activity);
      if (current.completion !== null) return;
      const operations = recording.operations(async () => {
        await compensationAuthority(tx, context, activity);
        assertActive();
      });
      await withPublicationPaths(context.files, plan, operations, async () => {
        await recording.assertCurrent();
        await prepared.assertCurrent();
        assertActive();
        await persistCompensationExecution(tx, { activity, execution });
        assertActive();
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  await context.files.checkpoint("native-compensation-execution-committed");
  await db.$transaction(
    async (tx) => {
      const current = await compensationAuthority(tx, context, activity);
      if (current.completion !== null) return;
      assertActive();
      for (const store of stores) {
        const authorityDeadline = await publicationAuthorityGuard(
          tx,
          context.files,
          { libraryKind: store.kind, recoveryEpoch: activity.recoveryEpoch },
        );
        store.bindAuthority(() => {
          assertActive();
          authorityDeadline();
        });
      }
      const operations = recording.operations(async () => {
        await compensationAuthority(tx, context, activity);
        assertActive();
      });
      await withPublicationPaths(context.files, plan, operations, async () => {
        await recording.assertCurrent();
        for (const observation of prepared.observations)
          if (observation.continuationId !== activity.continuationId)
            await observation.assertUnchanged();
        for (const journal of prepared.journals)
          await journal.assertCurrent(recording.state);
        for (const action of recording.actions) {
          const item = operations.find(
            (candidate) => candidate.kind === action.entry.libraryKind,
          );
          if (item === undefined)
            throw new Error("Compensation root executor missing");
          await executePublicationInverse(item.files, action);
        }
        if (recording.state.next !== undefined)
          throw new FileOperationConflict("Compensation inverse is incomplete");
        await recording.assertCurrent();
        for (const journal of prepared.journals)
          await journal.assertCurrent(recording.state);
        const completion = await compensationCompletion(
          tx,
          context.files,
          activity,
          { authority: current, state: recording.state },
        );
        await compensationAuthority(tx, context, activity);
        await commitNativeCompensation(tx, { activity, completion });
        await context.files.checkpoint("native-compensation-before-commit");
        await recording.assertCurrent();
        for (const store of stores) store.assertActive();
        assertPublicationActive(context.files);
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
