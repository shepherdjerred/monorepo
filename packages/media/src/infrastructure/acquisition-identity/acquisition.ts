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
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { assertMovieCutV2 } from "#infrastructure/movie-editions/cut-v2.ts";
import { assertMovieAcquisitionOperationV4 } from "#infrastructure/movie-editions/lifecycle/operation.ts";
import type { MovieCutEvidenceV2 } from "#shared/movie-editions/cut-v2.ts";

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

type IdentityInput = {
  operationId: string;
  sponsorRequestId: string;
  epoch: number;
  mediaIds: string[];
  serverMachineId?: string;
  movieAccess?: MovieChoiceAccess | undefined;
  movieScope?: MovieEditionScope | undefined;
};

async function candidateScope(
  tx: Prisma.TransactionClient,
  release: ReleaseCandidate,
  input: IdentityInput,
) {
  let editionEvidence: MovieCutEvidenceV2 | undefined;
  const scope =
    input.movieScope === undefined
      ? undefined
      : MovieEditionScopeSchema.parse(input.movieScope);
  if (scope === undefined)
    await assertDefaultAcquisitionEdition(tx, {
      releaseId: release.id,
      mediaIds: input.mediaIds,
    });
  else {
    if (input.mediaIds.length !== 1 || input.mediaIds[0] !== scope.mediaId)
      throw new MediaError(
        "identity_scope_changed",
        "Movie identity coverage differs from its edition scope",
        409,
      );
    await assertMovieAcquisitionOperationV4(
      tx,
      input.operationId,
      scope,
      input.epoch,
    );
    if (release.sourceEvidence === null)
      throw new MediaError(
        "identity_source_missing",
        "A v4 movie acquisition requires retained provider source evidence",
        409,
      );
    const assessed = await assertMovieCutV2(tx, {
      scope,
      releaseId: release.id,
      predecessorAssetIds: [],
      phase: "candidate",
      members: [],
    });
    editionEvidence = assessed.candidate;
  }
  return { scope, editionEvidence };
}

async function reviewedDecision(
  tx: Prisma.TransactionClient,
  input: IdentityInput,
  scope: MovieEditionScope | undefined,
) {
  const decision = await assertIdentityDecision(tx, input.operationId);
  if (scope !== undefined && decision !== null)
    throw new MediaError(
      "identity_review_scope_required",
      "Historical unscoped identity review cannot authorize a v4 movie edition",
      409,
    );
  if (decision !== null)
    await assertReviewedGenerations(tx, input.operationId, decision);
  return decision;
}

export async function acquisitionIdentity(
  tx: Prisma.TransactionClient,
  release: ReleaseCandidate,
  input: IdentityInput,
) {
  const { scope, editionEvidence } = await candidateScope(tx, release, input);
  const sponsorAuthority =
    release.sourceEvidence === null
      ? null
      : await captureSponsorAuthority(tx, input);
  const decision = await reviewedDecision(tx, input, scope);
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
  if (decision === null)
    await assertAutomaticIdentity(tx, release, canonical, editionEvidence);
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
