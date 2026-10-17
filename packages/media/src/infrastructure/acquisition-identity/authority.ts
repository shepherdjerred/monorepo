import { z } from "zod";
import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import {
  AcquisitionIdentitySnapshotSchema,
  IdentityDecisionSchema,
  type AcquisitionIdentitySnapshot,
} from "#shared/acquisition/identity.ts";
import {
  buildCanonicalIdentity,
  canonicalSemantics,
  candidateDigest,
  identityHash,
} from "./snapshot.ts";
import { authorizeRenewal } from "#infrastructure/action-guards.ts";
import { assertAutomaticIdentity } from "./automatic.ts";
import { assertSponsorAuthority } from "./sponsor.ts";

/** Caller retains canonical root/leaf, claims and runtime authority locks first. */
export async function assertIdentityDecision(
  tx: Prisma.TransactionClient,
  operationId: string,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const payload = z
    .object({ identityDecision: IdentityDecisionSchema.optional() })
    .parse(operation.payload);
  if (payload.identityDecision === undefined) return null;
  const decision = payload.identityDecision;
  if (
    operation.kind !== "acquire_release" ||
    operation.userId !== decision.actorId ||
    operation.targetId === null ||
    !decision.coverage.includes(operation.targetId)
  )
    throw new Error("Acquisition identity decision binding is corrupt");
  const { evidenceHash, ...unsigned } = decision;
  if (identityHash(unsigned) !== evidenceHash)
    throw new Error("Acquisition identity decision hash is corrupt");
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: decision.actorId },
  });
  for (const mediaId of decision.coverage)
    requireOwner(
      await authorizeRenewal(tx, owner, {
        mediaId,
        action: "select_release",
        serverMachineId: decision.serverMachineId,
      }),
    );
  const current = await buildCanonicalIdentity(tx, decision.coverage);
  if (
    identityHash(canonicalSemantics(current)) !==
    identityHash(canonicalSemantics(decision.canonical))
  )
    throw new MediaError(
      "identity_mapping_changed",
      "Reviewed canonical mapping changed",
      409,
    );
  return decision;
}

export async function assertAttemptIdentity(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  serverMachineId?: string,
): Promise<AcquisitionIdentitySnapshot | null> {
  if (attempt.identityEvidence === null) return null;
  const identity = AcquisitionIdentitySnapshotSchema.parse(
    attempt.identityEvidence,
  );
  if (
    serverMachineId === undefined ||
    identity.sponsorAuthority.serverMachineId !== serverMachineId
  )
    throw new MediaError(
      "acquisition_server_changed",
      "Acquisition permission evidence does not match this worker's configured Plex server",
      409,
    );
  if (
    identity.birthEpoch !== attempt.recoveryEpoch ||
    identity.source.releaseId !== attempt.releaseId ||
    identity.sponsorRequestId !== attempt.sponsorRequestId ||
    identityHash([...identity.coverage].sort()) !==
      identityHash([...attempt.mediaIds].sort())
  )
    throw new Error("Acquisition identity evidence binding is corrupt");
  await assertSponsorAuthority(tx, {
    authority: identity.sponsorAuthority,
    sponsorRequestId: identity.sponsorRequestId,
    operationId: attempt.operationId,
    mediaIds: attempt.mediaIds,
  });
  if (identity.proof.kind === "owner") {
    const decision = await assertIdentityDecision(
      tx,
      identity.proof.decisionOperationId,
    );
    if (
      decision?.evidenceHash !== identity.proof.decisionHash ||
      decision.recoveryEpoch !== attempt.recoveryEpoch ||
      decision.candidateDigest !== identity.source.candidateDigest ||
      decision.serverMachineId !== identity.sponsorAuthority.serverMachineId ||
      identityHash(canonicalSemantics(decision.canonical)) !==
        identityHash(canonicalSemantics(identity.canonical))
    )
      throw new Error("Acquisition owner decision is corrupt");
  }
  const current = await buildCanonicalIdentity(tx, attempt.mediaIds);
  if (
    identityHash(canonicalSemantics(current)) !==
    identityHash(canonicalSemantics(identity.canonical))
  )
    throw new MediaError(
      "identity_mapping_changed",
      "Acquired canonical mapping changed",
      409,
    );
  await tx.$queryRaw`SELECT id FROM "ReleaseCandidate" WHERE id = ${attempt.releaseId} FOR SHARE`;
  const release = await tx.releaseCandidate.findUniqueOrThrow({
    where: { id: attempt.releaseId },
  });
  if (candidateDigest(release) !== identity.source.candidateDigest)
    throw new MediaError(
      "identity_source_changed",
      "Acquired source evidence changed",
      409,
    );
  if (identity.proof.kind === "automatic")
    await assertAutomaticIdentity(tx, release, current);
  return identity;
}
