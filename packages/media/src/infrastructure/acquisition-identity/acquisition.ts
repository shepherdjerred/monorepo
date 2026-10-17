import { coordinateBlockers, sourceIdentityProof } from "./evaluation.ts";
import { assertDefaultAcquisitionEdition } from "#infrastructure/editions/acquisition.ts";
import type { IdentityDecision } from "#shared/acquisition/identity.ts";
import { z } from "zod";
import type { Prisma, ReleaseCandidate } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { AcquisitionIdentitySnapshotSchema } from "#shared/acquisition/identity.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import {
  buildCanonicalIdentity,
  candidateDigest,
  identityHash,
} from "./snapshot.ts";
import { assertIdentityDecision } from "./authority.ts";
import { assertAutomaticIdentity } from "./automatic.ts";
import { captureSponsorAuthority } from "./sponsor.ts";

export async function operationCoverage(
  tx: Prisma.TransactionClient,
  operationId: string,
  release: ReleaseCandidate,
): Promise<string[]> {
  const row = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const input = z
    .object({
      identityDecision: z
        .object({
          releaseId: z.uuid(),
          coverage: z.array(z.uuid()).min(1).max(100),
        })
        .optional(),
    })
    .parse(row.payload);
  if (input.identityDecision === undefined) return release.mediaIds;
  if (input.identityDecision.releaseId !== release.id)
    throw new Error("Selected identity decision has wrong release");
  return input.identityDecision.coverage;
}

export async function acquisitionIdentity(
  tx: Prisma.TransactionClient,
  release: ReleaseCandidate,
  input: {
    operationId: string;
    sponsorRequestId: string;
    epoch: number;
    mediaIds: string[];
    serverMachineId?: string;
  },
) {
  await assertDefaultAcquisitionEdition(tx, {
    releaseId: release.id,
    mediaIds: input.mediaIds,
  });
  const sponsorAuthority =
    release.sourceEvidence === null
      ? null
      : await captureSponsorAuthority(tx, input);
  const decision = await assertIdentityDecision(tx, input.operationId);
  if (decision !== null)
    await assertReviewedGenerations(tx, input.operationId, decision);
  if (release.sourceEvidence === null) {
    if (decision !== null)
      throw new MediaError(
        "identity_source_missing",
        "Selected source evidence is missing",
        409,
      );
    return null;
  }
  const canonical = await buildCanonicalIdentity(tx, input.mediaIds);
  const root = await tx.mediaItem.findUniqueOrThrow({
    where: {
      id:
        canonical.kind === "movie"
          ? canonical.mediaId
          : canonical.coordinates.seriesId,
    },
  });
  const sourceProof = sourceIdentityProof(root, release);
  const blockers = await coordinateBlockers(
    tx,
    canonical,
    release.title,
    input.mediaIds,
  );
  if (blockers.length > 0)
    throw new MediaError(
      blockers[0] ?? "identity_coverage_changed",
      "Release coordinates do not match complete selected coverage",
      409,
    );
  const attributes = PublicReleaseAttributesSchema.parse(release.attributes);
  if (decision === null) await assertAutomaticIdentity(tx, release, canonical);
  if (decision === null && attributes.identityConfidence !== "exact")
    throw new MediaError(
      "identity_unconfirmed",
      "Release identity needs owner confirmation",
      409,
    );
  const digest = candidateDigest(release);
  if (
    decision !== null &&
    (decision.candidateDigest !== digest ||
      decision.recoveryEpoch !== input.epoch)
  )
    throw new MediaError(
      "identity_source_changed",
      "Reviewed release or recovery epoch changed",
      409,
    );
  return AcquisitionIdentitySnapshotSchema.parse({
    schemaVersion: 1,
    source: { releaseId: release.id, candidateDigest: digest },
    proof:
      decision === null
        ? {
            kind: "automatic",
            ...sourceProof,
            evidenceHash: identityHash({ canonical, digest }),
          }
        : {
            kind: "owner",
            decisionOperationId: input.operationId,
            decisionHash: decision.evidenceHash,
          },
    canonical,
    coverage: [...input.mediaIds].sort(),
    sponsorRequestId: input.sponsorRequestId,
    sponsorAuthority,
    birthEpoch: input.epoch,
  });
}
async function assertReviewedGenerations(
  tx: Prisma.TransactionClient,
  operationId: string,
  decision: IdentityDecision,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const payload = z
    .object({ mediaId: z.uuid(), generation: z.number().int() })
    .parse(operation.payload);
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: decision.coverage } },
  });
  if (
    decision.reviewedMedia.some(
      (row) =>
        (intents.find((intent) => intent.mediaId === row.id)?.generation ??
          0) !==
        (row.id === payload.mediaId ? payload.generation : row.generation),
    )
  )
    throw new MediaError(
      "identity_intent_changed",
      "Reviewed household intent changed before acquisition",
      409,
    );
}
