import { z } from "zod";
import { assertDefaultAcquisitionEdition } from "#infrastructure/editions/acquisition.ts";
import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { IdentityDecisionSchema } from "#shared/acquisition/identity.ts";
import {
  DefaultAcquisitionIdentitySchema,
  type DefaultAcquisitionIdentity,
} from "#shared/acquisition/library-management.ts";
import { readLibrarySeriesManagement } from "./library-management.ts";
import { protectLibraryManagement } from "./library-policy.ts";
import {
  buildCanonicalIdentity,
  canonicalSemantics,
  candidateDigest,
  identityHash,
} from "./snapshot.ts";
import { authorizeRenewal } from "#infrastructure/action-guards.ts";
import { assertAutomaticIdentity } from "./automatic.ts";
import { assertSponsorAuthority, type AcquisitionAccess } from "./sponsor.ts";

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
  access?: string | AcquisitionAccess,
  purpose: "new_effect" | "resume_recorded_submission" = "new_effect",
): Promise<DefaultAcquisitionIdentity | null> {
  const authority =
    typeof access === "string" ? { serverMachineId: access } : access;
  const serverMachineId = authority?.serverMachineId;
  if (attempt.edition !== "default")
    throw new MediaError(
      "edition_not_available",
      "Only default acquisition is available",
      409,
    );
  await assertAttemptCut(tx, attempt, purpose);
  if (attempt.identityEvidence === null) return null;
  const identity = DefaultAcquisitionIdentitySchema.parse(
    attempt.identityEvidence,
  );
  if (
    serverMachineId === undefined ||
    (identity.schemaVersion === 1
      ? identity.sponsorAuthority.serverMachineId
      : identity.management.serverMachineId) !== serverMachineId
  )
    throw new MediaError(
      "acquisition_server_changed",
      "Acquisition permission evidence does not match this worker's configured Plex server",
      409,
    );
  if (
    identity.birthEpoch !== attempt.recoveryEpoch ||
    identity.source.releaseId !== attempt.releaseId ||
    (identity.schemaVersion === 1 ? identity.sponsorRequestId : null) !==
      attempt.sponsorRequestId ||
    identityHash([...identity.coverage].sort()) !==
      identityHash([...attempt.mediaIds].sort())
  )
    throw new Error("Acquisition identity evidence binding is corrupt");
  await assertIdentityPermission(tx, attempt, identity, authority);
  await assertAttemptOwnerDecision(tx, attempt.recoveryEpoch, identity);
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

async function assertIdentityPermission(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  identity: DefaultAcquisitionIdentity,
  authority: AcquisitionAccess | undefined,
) {
  if (identity.schemaVersion === 4) {
    if (authority?.libraryManagement === undefined)
      throw new Error(
        "Managed TV acquisition requires the original invocation and provenance allowance",
      );
    const management = await readLibrarySeriesManagement(
      tx,
      {
        mediaIds: identity.coverage,
        epoch: identity.birthEpoch,
        access: authority.libraryManagement.access,
        expected: identity.management,
      },
      authority.libraryManagement,
    );
    if (management === null) protectLibraryManagement();
    management.freshness.assertActive();
  } else
    await assertSponsorAuthority(tx, {
      authority: identity.sponsorAuthority,
      sponsorRequestId: identity.sponsorRequestId,
      operationId: attempt.operationId,
      mediaIds: attempt.mediaIds,
      movieAccess: authority?.movieAccess,
      recordedAttemptId: attempt.id,
    });
}

async function assertAttemptOwnerDecision(
  tx: Prisma.TransactionClient,
  epoch: number,
  identity: DefaultAcquisitionIdentity,
) {
  if (identity.proof.kind !== "owner") return;
  const decision = await assertIdentityDecision(
    tx,
    identity.proof.decisionOperationId,
  );
  if (
    decision?.evidenceHash !== identity.proof.decisionHash ||
    decision.recoveryEpoch !== epoch ||
    decision.candidateDigest !== identity.source.candidateDigest ||
    decision.serverMachineId !==
      (identity.schemaVersion === 1
        ? identity.sponsorAuthority.serverMachineId
        : identity.management.serverMachineId) ||
    identityHash(canonicalSemantics(decision.canonical)) !==
      identityHash(canonicalSemantics(identity.canonical))
  )
    throw new Error("Acquisition owner decision is corrupt");
}

async function assertAttemptCut(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  purpose: "new_effect" | "resume_recorded_submission",
): Promise<void> {
  if (attempt.state === "imported") return;
  if (
    purpose === "resume_recorded_submission" &&
    (attempt.state === "submitting" || attempt.state === "submission_unknown")
  )
    return;
  await assertDefaultAcquisitionEdition(tx, {
    releaseId: attempt.releaseId,
    mediaIds: attempt.mediaIds,
  });
}
