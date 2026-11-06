import type { discoverSeriesPackNativeV1 } from "./discovery.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import type { MeasurementAuthority } from "#filesystem/content-measurement.ts";
import {
  measurePublicationNamespace,
  type PublicationNamespaceMeasurement,
} from "#filesystem/publication-measurement.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";
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
import {
  recordedSubtitleDependencies,
  assertRecordedSubtitleDependencies,
} from "#automation/publication-proof/subtitle-lineage.ts";
import type { PublicationParticipant } from "#shared/publication-proof/intent.ts";
import type { PublicationEffectState } from "#automation/publication-proof/effect-state.ts";
import { measureCompensationContent } from "#automation/native-compensation/measurement-content.ts";
import type { CompensationFileContext } from "#automation/native-compensation/execution.ts";

function assertParticipants(
  participants: readonly PublicationParticipant[],
  state: PublicationEffectState,
) {
  for (const participant of participants) {
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
}

/** Discovery supplies comparison DATA only. Every byte read precedes DB/path locks. */
export async function measureSeriesPackNativeExecutionV1(
  initial: CompensationFileContext,
  discovery: Awaited<ReturnType<typeof discoverSeriesPackNativeV1>>,
  assertActive: () => void,
) {
  if (
    discovery.descriptor === null ||
    discovery.admission === null ||
    !("continuationId" in discovery.input)
  )
    throw new Error("Compensation measurement omitted current entry");
  const scope = discovery.descriptor.scope;
  const currentId = discovery.input.continuationId;
  const plan = scope.publication.intent.entries.map((item) => item.entry);
  const dependencies = recordedSubtitleDependencies(scope.publication.intent);
  const maxRecords = plan.reduce(
    (sum, entry) => sum + 12 + entry.previousSidecars.length * 8,
    0,
  );
  const maxRecordBytes =
    Buffer.byteLength(JSON.stringify(publicationReferences(plan))) * 64 +
    262_144;
  if (maxRecords < 1 || maxRecords > 10_000 || maxRecordBytes > 16_777_216)
    throw new FileOperationConflict(
      "Compensation record measurement is not bounded",
    );
  const content = await measureCompensationContent(
    initial,
    [...publicationReferences(plan), ...dependencies.references],
    assertActive,
  );
  await initial.files.checkpoint("content-proof-ready");
  assertActive();
  const checkpoint = async () => {
    assertActive();
    await initial.files.checkpoint("compensation-record-proof");
    assertActive();
  };
  const observations: (Awaited<ReturnType<typeof inspectPublicationRecords>> & {
    continuationId: string | null;
    kind: "movies" | "tv";
  })[] = [];
  const measurements: {
    kind: "movies" | "tv";
    measurement: PublicationNamespaceMeasurement;
  }[] = [];
  for (const kind of [
    ...new Set(plan.map((entry) => entry.libraryKind)),
  ].sort()) {
    for (const continuationId of [null]) {
      assertActive();
      observations.push({
        kind,
        continuationId,
        ...(await inspectPublicationRecords(initial.files.roots[kind], {
          transitionId: scope.transition.transitionId,
          continuationId,
          maxRecords,
          maxRecordBytes,
          checkpoint,
        })),
      });
      assertActive();
    }
    const binding = {
      transitionId: scope.transition.transitionId,
      continuationId: currentId,
    };
    // Apply truthfully admitted the absent future namespace. Initial creation
    // remains exclusive; retries only accept its actual contiguous causal WAL.
    const measurement = await measurePublicationNamespace(
      initial.files.roots[kind],
      {
        ...binding,
        maxRecords,
        maxRecordBytes,
        assertActive,
        checkpoint,
        ...(initial.files.verifyPlexExclusion === undefined
          ? {}
          : { verifyPlexExclusion: initial.files.verifyPlexExclusion }),
      },
    );
    measurements.push({ kind, measurement });
    assertActive();
  }
  const records = [
    ...observations.flatMap((item) => item.records),
    ...measurements.flatMap((item) => item.measurement.records),
  ].sort((a, b) => a.record.ordinal - b.record.ordinal);
  if (records.some((item) => effectHash(item.record) !== item.hash))
    throw new FileOperationConflict("Compensation record raw hash changed");
  const intent = {
    transitionId: scope.transition.transitionId,
    intentHash: scope.transition.intentHash,
    intent: scope.publication.intent,
  };
  const { state } = replayPublication(
    initial.files,
    intent,
    records.map((item) => item.record),
    { continuationId: currentId },
  );
  const journals = await capturePublicationJournalSet(initial.files, state);
  assertActive();
  const participants = await content.participants(plan);
  assertParticipants(participants, state);
  const allRecords = records.map((item) => item.record);
  const approved = discovery.descriptor.approvedFileEvidence;
  if (
    snapshotHash(
      nativeJson(allRecords.slice(0, approved.acknowledgedEffects.length)),
    ) !== approved.effectPrefixHash ||
    allRecords
      .slice(approved.acknowledgedEffects.length)
      .some((record) => record.continuationId !== currentId)
  )
    throw new FileOperationConflict(
      "Compensation prefix no longer extends the exact owner review",
    );
  if (
    discovery.admission.effectPrefixHash !== approved.effectPrefixHash ||
    snapshotHash(nativeJson(discovery.admission.participants)) !==
      snapshotHash(nativeJson(approved.participants))
  )
    throw new FileOperationConflict(
      "Native pack effects lack their actual owner-apply admission",
    );
  const assertRecords = async () => {
    for (const observation of observations) {
      await observation.assertUnchanged();
      assertActive();
    }
    for (const journal of journals) {
      await journal.assertCurrent(state);
      assertActive();
    }
  };
  await assertRecords();
  return Object.freeze({
    kind: "measurement" as const,
    intent,
    plan,
    state,
    measurements,
    observations,
    journals,
    allRecords,
    async seal(authority: MeasurementAuthority) {
      const currentActive = authority.assertActive;
      assertActive();
      await authority.assertCurrent();
      authority.assertActive();
      for (const { measurement } of measurements) {
        await measurement.assertUnchanged();
        authority.assertActive();
      }
      await assertRecords();
      const contentProof = await content.seal(authority);
      const context: CompensationFileContext = {
        ...initial,
        files: {
          ...initial.files,
          contentProof,
          publicationDependencies: dependencies,
        },
      };
      const assertCurrent = async () => {
        assertActive();
        currentActive();
        await assertRecordedSubtitleDependencies(
          context.files,
          contentProof,
          scope.publication.intent,
        );
        for (const entry of plan) {
          assertParticipants(
            await observePublicationParticipants(context.files, entry),
            state,
          );
          currentActive();
        }
        await assertRecords();
        currentActive();
      };
      await assertCurrent();
      return { context, assertCurrent };
    },
  });
}
