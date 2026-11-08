import { SeriesPackNativeFileEvidenceV3Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import { type SeriesPackNativeCompensationScopeV3 } from "#shared/native-recovery/series-pack/scope.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
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
import { ContentProof } from "#filesystem/content-proof.ts";
import { publicationRecordNamespace } from "#filesystem/publication-proof/records.ts";
import { safePath } from "#filesystem/operations-io.ts";
import { capturePublicationJournalSet } from "#automation/publication-proof/journal-set.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash, canonicalJson } from "#migration/profile-import.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import type { CompensationFileContext } from "#automation/native-compensation/execution.ts";
import {
  recordedSubtitleDependencies,
  assertRecordedSubtitleDependencies,
} from "#automation/publication-proof/subtitle-lineage.ts";

export async function captureSeriesPackNativeProofV1(
  initial: CompensationFileContext,
  scope: SeriesPackNativeCompensationScopeV3,
  input: {
    planId: string;
    currentContinuationId?: string;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { planId, currentContinuationId } = input;
  if (currentContinuationId !== undefined)
    throw new Error(
      "Execution uses the measured namespace path; review cannot adopt a live inverse namespace",
    );
  assertPublicationActive(initial.files);
  const plan = scope.publication.intent.entries.map((item) => item.entry);
  if (scope.previousCompensation !== null)
    throw new Error(
      "A previous new-protocol compensation requires its actual ancestry reader",
    );
  const namespaces = [null];
  const inverseRelative = publicationRecordNamespace({
    transitionId: scope.transition.transitionId,
    continuationId: planId,
  });
  const inverseFilename = await safePath(
    initial.files.roots.tv.control,
    inverseRelative,
    false,
  );
  const absentInverse = new ContentProof();
  await absentInverse.capture(inverseFilename, () =>
    initial.files.checkpoint("compensation-record-proof"),
  );
  absentInverse.seal();
  const inverseAbsence = await absentInverse.reviewAbsence(inverseFilename);
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
          allowAbsent: false,
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
    intent: scope.publication.intent,
  };
  const { state, actions } = replayPublication(
    initial.files,
    intent,
    records.map((item) => item.record),
    { continuationId: null },
  );
  const journals = await capturePublicationJournalSet(initial.files, state);
  const dependencies = recordedSubtitleDependencies(scope.publication.intent);
  const prepared = await prepareContentProof(initial.files, [
    ...publicationReferences(plan),
    ...dependencies.references,
    // The final lock scope includes this absent namespace. Its same-instance
    // content proof must capture it too; the independent absence proof above
    // continues to bind the reviewed future namespace and its real ancestors.
    { libraryKind: "tv", root: "control", path: inverseRelative },
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
      scope.publication.intent,
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
    await absentInverse.reviewAbsence(inverseFilename);
    assertPublicationActive(context.files);
  };
  await assertCurrent();
  const evidence = SeriesPackNativeFileEvidenceV3Schema.parse({
    schemaVersion: 3,
    protocol: "series_pack_publication_v3",
    inverseNamespace: {
      root: "control",
      path: inverseRelative,
      state: "absent",
      ancestors: inverseAbsence.ancestors,
    },
    lifecycleKind: "publication_compensation",
    planId,
    recoveryEpoch: scope.request.recoveryEpoch,
    workerPodUid: context.workerPodUid,
    capturedAt: new Date().toISOString(),
    transitionId: intent.transitionId,
    intentHash: intent.intentHash,
    acknowledgedEffects: records.map((item) => item.record),
    acknowledgedRaw: records.map((item) => JSON.stringify(item.record)),
    effectPrefixRaw: canonicalJson(
      records.map((item) => nativeJson(item.record)),
    ),
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
