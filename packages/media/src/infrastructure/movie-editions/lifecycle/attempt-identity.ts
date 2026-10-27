import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  MovieAcquisitionIdentitySchema,
  type MovieAcquisitionIdentity,
} from "#shared/movie-editions/management/contracts.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/authority.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { readMovieAssessment } from "#infrastructure/movie-editions/release-assessment.ts";
import { readMovieAttemptSponsor } from "#infrastructure/movie-editions/attempt-sponsor.ts";
import { assertSponsorAuthority } from "#infrastructure/acquisition-identity/sponsor.ts";
import {
  buildCanonicalIdentity,
  canonicalSemantics,
  candidateDigest,
  identityHash,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertAutomaticIdentity } from "#infrastructure/acquisition-identity/automatic.ts";
import { sourceIdentityProof } from "#infrastructure/acquisition-identity/evaluation.ts";
import { assertMovieCutV2 } from "#infrastructure/movie-editions/cut-v2.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { assertMovieChoiceV4 } from "./authority.ts";

/** Literal birth evidence only. This read never authorizes a new transfer or filesystem effect. */
export async function readMovieAttemptIdentityV4(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  input: MovieEditionScope,
) {
  const scope = MovieEditionScopeSchema.parse(input);
  const identity = MovieAcquisitionIdentitySchema.parse(
    attempt.identityEvidence,
  );
  if (
    identityHash(identity.scope) !== identityHash(scope) ||
    attempt.edition !== scope.edition ||
    attempt.mediaIds.length !== 1 ||
    attempt.mediaIds[0] !== scope.mediaId ||
    identity.birthEpoch !== attempt.recoveryEpoch ||
    identity.source.releaseId !== attempt.releaseId ||
    (identity.schemaVersion === 2 ? identity.sponsorRequestId : null) !==
      attempt.sponsorRequestId
  )
    throw new Error(
      "Movie v4 acquisition identity does not match its immutable attempt scope",
    );
  const assessed = readMovieAssessment(
    await tx.movieReleaseAssessment.findUniqueOrThrow({
      where: { id: identity.assessment.id },
    }),
  );
  if (
    assessed.ref.hash !== identity.assessment.hash ||
    assessed.value.releaseId !== attempt.releaseId ||
    assessed.value.sourceHash !== identity.source.candidateDigest ||
    identityHash(assessed.value.scope) !== identityHash(scope) ||
    identityHash(assessed.value.canonical) !== identityHash(identity.canonical)
  )
    throw new Error("Movie v4 acquisition assessment binding is corrupt");
  await assertBirthIdentity(tx, attempt, identity);
  await tx.$queryRaw`SELECT id FROM "ReleaseCandidate" WHERE id = ${attempt.releaseId} FOR SHARE`;
  const release = await tx.releaseCandidate.findUniqueOrThrow({
    where: { id: attempt.releaseId },
  });
  if (candidateDigest(release) !== identity.source.candidateDigest)
    throw new MediaError(
      "identity_source_changed",
      "Movie acquisition source changed",
      409,
    );
  if (identity.proof.kind !== "automatic")
    throw new MediaError(
      "identity_review_scope_required",
      "Movie acquisition requires a versioned owner identity review",
      409,
    );
  const hash = identityHash({
    schemaVersion: identity.schemaVersion,
    scope,
    assessment: assessed.ref,
    canonical: identity.canonical,
    digest: identity.source.candidateDigest,
  });
  if (hash !== identity.proof.evidenceHash)
    throw new Error("Movie v4 acquisition identity proof hash is corrupt");
  return { identity, assessment: assessed.value, release };
}

/** Caller owns complete movie/target/request/runtime locks before identity reads and physical effects. */
export async function assertMovieAttemptIdentityV4(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  scope: MovieEditionScope,
  authority: {
    access: MovieChoiceAccess;
    invocation?: MovieManagementInvocation;
  },
) {
  const { access, invocation } = authority;
  const captured = await readMovieAttemptIdentityV4(tx, attempt, scope);
  const identity = captured.identity;
  if (
    (identity.schemaVersion === 2
      ? identity.sponsorAuthority.serverMachineId
      : identity.management.serverMachineId) !== access.serverMachineId
  )
    throw new MediaError(
      "acquisition_server_changed",
      "Movie acquisition belongs to another Plex server",
      409,
    );
  const freshness = await assertMovieChoiceV4(tx, {
    attemptId: attempt.id,
    scope,
    epoch: attempt.recoveryEpoch,
    access,
    ...(invocation === undefined ? {} : { invocation }),
  });
  if (identity.schemaVersion === 2)
    await assertSponsorAuthority(tx, {
      authority: identity.sponsorAuthority,
      sponsorRequestId: identity.sponsorRequestId,
      operationId: attempt.operationId,
      mediaIds: attempt.mediaIds,
      movieAccess: access,
      movieScope: scope,
      recordedAttemptId: attempt.id,
    });
  const current = await buildCanonicalIdentity(tx, [scope.mediaId]);
  if (
    identityHash(canonicalSemantics(current)) !==
    identityHash(canonicalSemantics(identity.canonical))
  )
    throw new MediaError(
      "identity_mapping_changed",
      "Movie acquisition canonical mapping changed",
      409,
    );
  const cut = await assertMovieCutV2(tx, {
    scope,
    releaseId: attempt.releaseId,
    predecessorAssetIds: [],
    phase: "candidate",
    members: [],
  });
  if (identityHash(cut.candidate) !== identityHash(captured.assessment.cut))
    throw new MediaError(
      "movie_assessment_changed",
      "Movie acquisition cut evidence changed",
      409,
    );
  const root = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
  });
  const proof = sourceIdentityProof(root, captured.release);
  if (
    identity.proof.kind !== "automatic" ||
    identityHash(proof) !==
      identityHash({
        basis: identity.proof.basis,
        references: identity.proof.references,
      })
  )
    throw new MediaError(
      "identity_mapping_changed",
      "Movie acquisition proof no longer matches its source",
      409,
    );
  await assertAutomaticIdentity(
    tx,
    {
      ...captured.release,
      attributes: captured.assessment.attributes,
      mediaIds: [scope.mediaId],
    },
    current,
    captured.assessment.cut,
  );
  freshness.assertActive();
  return { ...captured, freshness };
}

async function assertBirthIdentity(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  identity: MovieAcquisitionIdentity,
) {
  if (identity.schemaVersion === 3) {
    if (
      attempt.movieEditionChoiceId !== null ||
      attempt.movieEditionChoiceRevision !== null ||
      identityHash(attempt.movieEditionAuthority) !==
        identityHash(identity.management)
    )
      throw new Error(
        "Management acquisition differs from its immutable owner approval",
      );
    return;
  }
  const sponsor = await readMovieAttemptSponsor(tx, {
    attemptId: attempt.id,
    expectedScope: identity.scope,
    expectedRequestId: identity.sponsorRequestId,
  });
  if (
    sponsor === null ||
    identityHash(sponsor) !== identityHash(identity.sponsorAuthority)
  )
    throw new Error(
      "Movie v4 birth sponsor differs from canonical acquisition identity",
    );
}
