import type { Prisma } from "#generated/prisma/client.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import {
  NativeCompensationCompletionSchema,
  type NativeCompensationActivityInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import type { CompensationExecutionAuthority } from "#infrastructure/native-compensation/guards.ts";
import { observePublicationParticipants } from "#automation/publication-proof/participants.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { PublicationEffectState } from "#automation/publication-proof/effect-state.ts";

export async function compensationCompletion(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  input: NativeCompensationActivityInput,
  execution: {
    authority: CompensationExecutionAuthority;
    state: PublicationEffectState;
  },
) {
  const { authority, state } = execution;
  const predecessorBindings = [];
  const retainedArtifacts = [];
  for (const { entry } of authority.descriptor.scope.intent.entries) {
    if (entry.previousAssetId === null)
      throw new Error("Native compensation requires a published predecessor");
    const before = await snapshotPublicationAsset(tx, entry.previousAssetId);
    const after = {
      ...before,
      version: before.version + 1,
      ownershipEpoch: input.recoveryEpoch,
      subtitles: before.subtitles.map((subtitle) => ({
        ...subtitle,
        version: subtitle.version + 1,
        ownershipEpoch: input.recoveryEpoch,
        videoVersion: before.version + 1,
      })),
    };
    const observed = await observePublicationParticipants(context, entry);
    predecessorBindings.push({
      before,
      after,
      participants: observed.filter(
        (item) =>
          item.physical.root === "library" &&
          (item.role === "video" || item.role === "sidecar"),
      ),
    });
    retainedArtifacts.push(
      ...observed.filter((item) => item.physical.root === "control"),
    );
  }
  const { reservations: releasedReservations, ...reviewed } =
    authority.descriptor.scope.interruptedWork;
  return NativeCompensationCompletionSchema.parse({
    schemaVersion: 1,
    continuationId: input.continuationId,
    receiptId: authority.receiptId,
    descriptorHash: authority.descriptorHash,
    recoveryEpoch: input.recoveryEpoch,
    transition: authority.descriptor.scope.transition,
    compensationEffects: state.refs.slice(
      authority.descriptor.approvedFileEvidence.acknowledgedEffects.length,
    ),
    predecessorBindings,
    retainedArtifacts,
    journals: [...state.journals.values()],
    settlement: { ...reviewed, releasedReservations },
    completedAt: new Date().toISOString(),
  });
}
