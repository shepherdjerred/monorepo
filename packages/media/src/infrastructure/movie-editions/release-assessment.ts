import { z } from "zod";
import {
  Prisma,
  type MovieReleaseAssessment as AssessmentRow,
} from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  buildCanonicalIdentity,
  candidateDigest,
  canonicalSemantics,
  identityHash,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import {
  MovieReleaseAssessmentSchema,
  type MovieReleaseAssessment,
  type MovieReleaseAssessmentRef,
} from "#shared/movie-editions/release-assessment.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { CanonicalIdentitySchema } from "#shared/acquisition/identity.ts";
import { QualityRulesSchema } from "#shared/api.ts";

/** Read under the caller's canonical/target locks when establishing acquisition authority. */
export async function movieAssessmentContext(
  tx: Prisma.TransactionClient,
  input: MovieEditionScope,
) {
  const scope = MovieEditionScopeSchema.parse(input);
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
    include: { media: true, profile: true },
  });
  if (
    target.media.kind !== "movie" ||
    target.editionRootId !== scope.rootMediaId
  )
    throw assessmentChanged("Movie assessment target lineage changed");
  if (target.profile === null)
    throw new MediaError(
      "quality_profile_missing",
      "Movie edition needs a quality profile",
      409,
    );
  const snapshot = await tx.qualityProfileVersion.findUniqueOrThrow({
    where: {
      profileId_version: {
        profileId: target.profile.id,
        version: target.profile.version,
      },
    },
  });
  const canonical = CanonicalIdentitySchema.options[0].parse(
    await buildCanonicalIdentity(tx, [scope.mediaId]),
  );
  const metadata = {
    runtimeMinutes: target.media.runtimeMinutes,
    originalLanguage: target.media.originalLanguage,
  };
  return {
    scope,
    media: target.media,
    canonical,
    ...metadata,
    canonicalHash: identityHash({
      canonical: canonicalSemantics(canonical),
      ...metadata,
    }),
    profile: {
      id: snapshot.profileId,
      version: snapshot.version,
      hash: identityHash(snapshot.rules),
    },
    rules: QualityRulesSchema.parse(snapshot.rules),
  };
}

function assessmentChanged(message: string) {
  return new MediaError("movie_assessment_changed", message, 409);
}

/** Validate literal bytes before projecting the versioned assessment. */
export function readMovieAssessment(row: AssessmentRow) {
  const value = MovieReleaseAssessmentSchema.parse(row.assessment);
  if (
    canonicalJson(z.json().parse(value)) !== row.raw ||
    identityHash(value) !== row.assessmentHash ||
    value.releaseId !== row.releaseId ||
    value.scope.mediaId !== row.mediaId ||
    value.scope.edition !== row.edition ||
    value.sourceHash !== row.sourceHash ||
    value.canonicalHash !== row.canonicalHash ||
    value.profile.id !== row.profileId ||
    value.profile.version !== row.profileVersion ||
    value.profile.hash !== row.profileHash ||
    value.parserVersion !== row.parserVersion
  )
    throw new Error("Movie release assessment integrity mismatch");
  return { ref: { id: row.id, hash: row.assessmentHash }, value };
}

async function assertCurrent(
  tx: Prisma.TransactionClient,
  value: MovieReleaseAssessment,
) {
  const current = await movieAssessmentContext(tx, value.scope);
  const release = await tx.releaseCandidate.findUniqueOrThrow({
    where: { id: value.releaseId },
  });
  if (
    candidateDigest(release) !== value.sourceHash ||
    current.canonicalHash !== value.canonicalHash ||
    identityHash({
      canonical: canonicalSemantics(value.canonical),
      runtimeMinutes: value.runtimeMinutes,
      originalLanguage: value.originalLanguage,
    }) !== value.canonicalHash ||
    identityHash(current.profile) !== identityHash(value.profile)
  )
    throw assessmentChanged(
      "Provider source, canonical metadata or quality profile changed",
    );
  return { current, release };
}

/** Caller locks canonical/target, then this provider row. Network preparation precedes this transaction. */
export async function appendMovieAssessment(
  tx: Prisma.TransactionClient,
  input: MovieReleaseAssessment,
) {
  const value = MovieReleaseAssessmentSchema.parse(input);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ReleaseCandidate" WHERE id = ${value.releaseId} FOR UPDATE`,
  );
  await assertCurrent(tx, value);
  const lookup = {
    releaseId: value.releaseId,
    mediaId: value.scope.mediaId,
    edition: value.scope.edition,
    sourceHash: value.sourceHash,
    canonicalHash: value.canonicalHash,
    profileId: value.profile.id,
    profileVersion: value.profile.version,
    profileHash: value.profile.hash,
    parserVersion: value.parserVersion,
  };
  // Reuse the first literal observation even when a request-only media version has advanced.
  const previous = await tx.movieReleaseAssessment.findUnique({
    where: { lookup },
  });
  if (previous !== null) return readMovieAssessment(previous);
  const raw = canonicalJson(z.json().parse(value));
  if (Buffer.byteLength(raw, "utf8") > 131_072)
    throw new MediaError(
      "movie_assessment_too_large",
      "Release assessment exceeds its evidence bound",
      422,
    );
  await tx.movieReleaseAssessment.createMany({
    data: [
      {
        ...lookup,
        raw,
        assessment: z.record(z.string(), z.json()).parse(value),
        assessmentHash: identityHash(value),
      },
    ],
    skipDuplicates: true,
  });
  return readMovieAssessment(
    await tx.movieReleaseAssessment.findUniqueOrThrow({ where: { lookup } }),
  );
}

export async function assertCurrentMovieAssessment(
  tx: Prisma.TransactionClient,
  ref: MovieReleaseAssessmentRef,
  scope: MovieEditionScope,
  releaseId: string,
) {
  const assessed = readMovieAssessment(
    await tx.movieReleaseAssessment.findUniqueOrThrow({
      where: { id: ref.id },
    }),
  );
  if (
    assessed.ref.hash !== ref.hash ||
    assessed.value.releaseId !== releaseId ||
    identityHash(assessed.value.scope) !==
      identityHash(MovieEditionScopeSchema.parse(scope))
  )
    throw assessmentChanged(
      "Release assessment belongs to another source or movie edition",
    );
  const { current, release } = await assertCurrent(tx, assessed.value);
  return { ...assessed, current, release };
}
