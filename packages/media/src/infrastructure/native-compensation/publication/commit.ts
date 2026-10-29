import { Prisma } from "#generated/prisma/client.ts";
import {
  NativeCompensationVerifiedPublicationSchema,
  NativeCompensationFenceReleaseSchema,
  type NativeCompensationVerifiedPublication,
} from "#shared/native-recovery/compensation-runtime.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  assertCompensationPublicationPhaseCurrent,
  type CompensationPublicationPhase,
} from "./phase.ts";

/** Final writer in the SAME transaction as serving bindings and availability. */
export async function commitCompensatedPublicationPhase(
  tx: Prisma.TransactionClient,
  phase: CompensationPublicationPhase,
  publication: NativeCompensationVerifiedPublication,
  options: {
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
  },
): Promise<void> {
  const { freshness, budget } = options;
  freshness.assertActive();
  const authority = await assertCompensationPublicationPhaseCurrent(
    tx,
    phase,
    budget,
  );
  const guard = {
    expiresAtMs: Math.min(freshness.expiresAtMs, phase.freshness.expiresAtMs),
    assertActive() {
      freshness.assertActive();
      phase.freshness.assertActive();
    },
  };
  await bindPlexTransactionDeadline(tx, guard);
  guard.assertActive();
  const proof = NativeCompensationVerifiedPublicationSchema.parse(publication);
  assertPublicationCoverage(authority, proof);
  assertPublicationItems(phase, proof);
  for (const ancestor of phase.chain) {
    guard.assertActive();
    if (ancestor.row.fenceRelease !== null)
      throw new Error("Compensation ancestor fence was already released");
    const release = NativeCompensationFenceReleaseSchema.parse({
      schemaVersion: 1,
      continuationId: ancestor.row.id,
      transitionId: ancestor.row.transitionId,
      settlingContinuationId: authority.continuationId,
      settlingCompletionHash: authority.completionHash,
      publicationHash: snapshotHash(nativeJson(proof)),
      releasedAt: proof.verifiedAt,
    });
    const settling = ancestor.row.id === authority.continuationId;
    const changed =
      await tx.nativePublicationCompensationContinuation.updateMany({
        where: {
          id: ancestor.row.id,
          version: ancestor.row.version,
          receiptId: ancestor.row.receiptId,
          transitionId: ancestor.row.transitionId,
          descriptorHash: ancestor.row.descriptorHash,
          publicationCoordinatorOperationId:
            ancestor.row.publicationCoordinatorOperationId,
          fenceRelease: { equals: Prisma.DbNull },
          ...(settling
            ? { verifiedPublication: { equals: Prisma.DbNull } }
            : {}),
        },
        data: {
          fenceRelease: release,
          ...(settling ? { verifiedPublication: proof } : {}),
          version: { increment: 1 },
        },
      });
    guard.assertActive();
    if (changed.count !== 1)
      throw new Error("Compensation publication completion CAS changed");
    const written =
      await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: ancestor.row.id },
      });
    budget.consume(1);
    guard.assertActive();
    const {
      receipt: _receipt,
      transition: _transition,
      updatedAt: _updatedAt,
      ...before
    } = ancestor.row;
    const { updatedAt: _writtenAt, ...after } = written;
    const expected = {
      ...before,
      fenceRelease: release,
      ...(settling ? { verifiedPublication: proof } : {}),
      version: before.version + 1,
    };
    if (snapshotHash(nativeJson(after)) !== snapshotHash(nativeJson(expected)))
      throw new Error("Compensation publication completion readback changed");
  }
  guard.assertActive();
  phase.closed = true;
}

function assertPublicationCoverage(
  authority: CompensationPublicationPhase["authority"],
  proof: NativeCompensationVerifiedPublication,
) {
  if (
    proof.continuationId !== authority.continuationId ||
    proof.operationId !== authority.publicationOperationId ||
    proof.recoveryEpoch !== authority.recoveryEpoch ||
    proof.completionHash !== authority.completionHash ||
    proof.commandHash !== authority.commandHash ||
    proof.bindingsHash !== authority.bindingsHash ||
    snapshotHash(proof.generations) !== snapshotHash(authority.generations) ||
    proof.items.length !== authority.mediaIds.length ||
    new Set(proof.items.map((item) => item.mediaId)).size !==
      authority.mediaIds.length
  )
    throw new Error(
      "Compensation verified publication omitted exact command coverage",
    );
}

function assertPublicationItems(
  phase: CompensationPublicationPhase,
  proof: NativeCompensationVerifiedPublication,
) {
  for (const item of proof.items) {
    const binding = phase.record.completion.predecessorBindings.find(
      ({ after }) => after.id === item.assetId,
    );
    if (
      binding === undefined ||
      !binding.after.coverage.some(
        (row) => row.current && row.mediaId === item.mediaId,
      ) ||
      binding.after.version !== item.assetVersion ||
      binding.after.checksum !== item.checksum ||
      binding.after.path !== item.canonicalPath
    )
      throw new Error(
        "Compensation verified Plex item differs from completed physical binding",
      );
  }
}
