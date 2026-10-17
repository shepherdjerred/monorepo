import {
  NativeCompensationFileEvidenceSchema,
  NativeCompensationScopeSchema,
  type NativeCompensationScope,
} from "#shared/native-recovery/compensation.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { prepareContentProof } from "#automation/files/content-proof.ts";
import {
  publicationReferences,
  observePublicationParticipants,
} from "#automation/publication-proof/participants.ts";
import { replayPublication } from "#automation/publication-proof/replay.ts";
import {
  physicalKey,
  effectHash,
} from "#automation/publication-proof/effect-state.ts";
import { capturePublicationJournalSet } from "#automation/publication-proof/journal-set.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import { compensationAncestors } from "#infrastructure/native-compensation/records.ts";
import type { CompensationFileContext } from "./execution.ts";
import {
  recordedSubtitleDependencies,
  assertRecordedSubtitleDependencies,
} from "#automation/publication-proof/subtitle-lineage.ts";

export async function captureCompensationProof(
  initial: CompensationFileContext,
  scope: NativeCompensationScope,
  planId: string,
  currentContinuationId?: string,
) {
  assertPublicationActive(initial.files);
  const plan = scope.intent.entries.map((item) => item.entry);
  const previous =
    scope.previousCompensation === null
      ? []
      : await compensationAncestors(
          initial.files.db,
          scope.previousCompensation.continuationId,
        );
  const namespaces = [
    null,
    ...previous.map((item) => item.row.id),
    ...(currentContinuationId === undefined ? [] : [currentContinuationId]),
  ];
  const observations: (Awaited<ReturnType<typeof inspectPublicationRecords>> & {
    continuationId: string | null;
    kind: "movies" | "tv";
  })[] = [];
  for (const kind of [
    ...new Set(plan.map((entry) => entry.libraryKind)),
  ].sort())
    for (const continuationId of namespaces)
      observations.push({
        continuationId,
        kind,
        ...(await inspectPublicationRecords(initial.files.roots[kind], {
          transitionId: scope.transition.transitionId,
          continuationId,
          maxRecords: plan.reduce(
            (sum, entry) => sum + 12 + entry.previousSidecars.length * 8,
            0,
          ),
          maxRecordBytes:
            Buffer.byteLength(JSON.stringify(publicationReferences(plan))) *
              64 +
            262_144,
          checkpoint: () =>
            initial.files.checkpoint("compensation-record-proof"),
          allowAbsent: previous.some(
            (item) => item.row.id === continuationId && item.execution === null,
          ),
        })),
      });
  const records = observations
    .flatMap((item) => item.records)
    .sort((a, b) => a.record.ordinal - b.record.ordinal);
  if (records.some((item) => effectHash(item.record) !== item.hash))
    throw new FileOperationConflict("Compensation record raw hash changed");
  const intent = {
    transitionId: scope.transition.transitionId,
    intentHash: scope.transition.intentHash,
    intent: scope.intent,
  };
  const { state, actions } = replayPublication(
    initial.files,
    intent,
    records.map((item) => item.record),
    { continuationId: currentContinuationId ?? null },
  );
  const journals = await capturePublicationJournalSet(initial.files, state);
  const dependencies = recordedSubtitleDependencies(scope.intent);
  const prepared = await prepareContentProof(initial.files, [
    ...publicationReferences(plan),
    ...dependencies.references,
  ]);
  const context: CompensationFileContext = {
    ...initial,
    files: {
      ...prepared,
      execution: initial.files.execution,
      publicationDependencies: dependencies,
    },
  };
  const participants = [];
  for (const entry of plan)
    participants.push(
      ...(await observePublicationParticipants(context.files, entry)),
    );
  const assertCurrent = async () => {
    assertPublicationActive(context.files);
    if (context.files.contentProof === undefined)
      throw new Error("Compensation content proof missing");
    await assertRecordedSubtitleDependencies(
      context.files,
      context.files.contentProof,
      scope.intent,
    );
    for (const entry of plan)
      for (const participant of await observePublicationParticipants(
        context.files,
        entry,
      )) {
        const expected = state.physical.get(
          physicalKey(participant.libraryKind, participant.physical),
        );
        if (
          expected === undefined ||
          snapshotHash(nativeJson(expected)) !==
            snapshotHash(nativeJson(participant.physical))
        )
          throw new FileOperationConflict(
            "Compensation path differs from its durable effect prefix",
          );
      }
    for (const observation of observations) await observation.assertUnchanged();
    for (const journal of journals) await journal.assertCurrent(state);
    assertPublicationActive(context.files);
  };
  await assertCurrent();
  const evidence = NativeCompensationFileEvidenceSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "publication_compensation",
    planId,
    recoveryEpoch: scope.request.recoveryEpoch,
    workerPodUid: context.workerPodUid,
    capturedAt: new Date().toISOString(),
    transitionId: intent.transitionId,
    intentHash: intent.intentHash,
    acknowledgedEffects: records.map((item) => item.record),
    effectPrefixHash: snapshotHash(
      nativeJson(records.map((item) => item.record)),
    ),
    participants,
    steps: actions.map((action) => action.descriptor),
    journalDigests: journals.map((item) => ({
      libraryKind: item.kind,
      digest: item.digest,
    })),
  });
  return {
    context,
    scope,
    intent,
    state,
    observations,
    journals,
    evidence,
    assertCurrent,
  };
}

export async function prepareNativeCompensationProof(
  context: CompensationFileContext,
  planId: string,
) {
  const plan = await context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  assertPublicationActive(context.files);
  return await captureCompensationProof(
    context,
    NativeCompensationScopeSchema.parse(plan.scope),
    planId,
  );
}
