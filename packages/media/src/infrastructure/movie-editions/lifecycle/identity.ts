import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { assertCurrentMovieAssessment } from "#infrastructure/movie-editions/release-assessment.ts";
import { assertMovieAcquisitionOperationV4 } from "./operation.ts";
import { assertMovieCutV2 } from "#infrastructure/movie-editions/cut-v2.ts";
import { captureSponsorAuthority } from "#infrastructure/acquisition-identity/sponsor.ts";
import {
  sourceIdentityProof,
  coordinateBlockers,
} from "#infrastructure/acquisition-identity/evaluation.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertAutomaticIdentity } from "#infrastructure/acquisition-identity/automatic.ts";
import { MediaError } from "#application/errors.ts";
import { MovieAcquisitionIdentityV2Schema } from "#shared/movie-editions/acquisition-v2.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieReleaseAssessmentRef } from "#shared/movie-editions/release-assessment.ts";

/** Caller owns canonical, target, request and runtime locks; identity locks follow them. */
export async function movieAcquisitionIdentityV4(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    sponsorRequestId: string;
    releaseId: string;
    epoch: number;
    scope: MovieEditionScope;
    assessment: MovieReleaseAssessmentRef;
    access: MovieChoiceAccess;
  },
) {
  const { operation } = await assertMovieAcquisitionOperationV4(
    tx,
    input.operationId,
    input.scope,
    input.epoch,
  );
  if (
    operation.payload !== null &&
    typeof operation.payload === "object" &&
    Object.hasOwn(operation.payload, "identityDecision")
  )
    throw new MediaError(
      "identity_review_scope_required",
      "Movie v4 acquisition needs an edition-scoped identity review",
      409,
    );
  const assessed = await assertCurrentMovieAssessment(
    tx,
    input.assessment,
    input.scope,
    input.releaseId,
  );
  const cut = await assertMovieCutV2(tx, {
    scope: input.scope,
    releaseId: input.releaseId,
    predecessorAssetIds: [],
    phase: "candidate",
    members: [],
  });
  if (identityHash(cut.candidate) !== identityHash(assessed.value.cut))
    throw new MediaError(
      "movie_assessment_changed",
      "Movie source cut assessment changed",
      409,
    );
  const sponsorAuthority = await captureSponsorAuthority(tx, {
    operationId: input.operationId,
    sponsorRequestId: input.sponsorRequestId,
    mediaIds: [input.scope.mediaId],
    serverMachineId: input.access.serverMachineId,
    movieAccess: input.access,
    movieScope: input.scope,
  });
  const proof = sourceIdentityProof(assessed.current.media, assessed.release);
  const blockers = await coordinateBlockers(
    tx,
    assessed.value.canonical,
    assessed.release.title,
    [input.scope.mediaId],
  );
  if (blockers.length > 0)
    throw new MediaError(
      blockers[0] ?? "identity_coverage_changed",
      "Movie source contains episode coordinates",
      409,
    );
  // This projection is used only for revalidation. The source digest always binds the original row.
  const projected = {
    ...assessed.release,
    mediaIds: [input.scope.mediaId],
    attributes: assessed.value.attributes,
  };
  await assertAutomaticIdentity(
    tx,
    projected,
    assessed.value.canonical,
    assessed.value.cut,
  );
  if (assessed.value.attributes.identityConfidence !== "exact")
    throw new MediaError(
      "identity_unconfirmed",
      "Movie release identity needs owner confirmation",
      409,
    );
  return MovieAcquisitionIdentityV2Schema.parse({
    schemaVersion: 2,
    scope: input.scope,
    assessment: assessed.ref,
    source: {
      releaseId: input.releaseId,
      candidateDigest: assessed.value.sourceHash,
    },
    canonical: assessed.value.canonical,
    coverage: [input.scope.mediaId],
    sponsorRequestId: input.sponsorRequestId,
    sponsorAuthority,
    birthEpoch: input.epoch,
    proof: {
      kind: "automatic",
      ...proof,
      evidenceHash: identityHash({
        schemaVersion: 2,
        scope: input.scope,
        assessment: assessed.ref,
        canonical: assessed.value.canonical,
        digest: assessed.value.sourceHash,
      }),
    },
  });
}
