import type { Prisma, ReleaseCandidate } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { matchRelease } from "#domain/release-parser.ts";
import {
  CandidateSourceEvidenceSchema,
  type CanonicalIdentity,
} from "#shared/acquisition/identity.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { referenceConflict } from "./evaluation.ts";
import { buildCanonicalIdentity, identityHash } from "./snapshot.ts";
import { canonicalReferences } from "./references.ts";
import { matchMovieReleaseV4 } from "#domain/editions/release-v4.ts";
import type { MovieCutEvidenceV2 } from "#shared/movie-editions/cut-v2.ts";

/** Recheck identity only; never replace immutable quality evidence with reparsed fields. */
export async function assertAutomaticIdentity(
  tx: Prisma.TransactionClient,
  release: ReleaseCandidate,
  canonical?: CanonicalIdentity,
  editionEvidence?: MovieCutEvidenceV2,
) {
  const current =
    canonical ?? (await buildCanonicalIdentity(tx, release.mediaIds));
  const root = await tx.mediaItem.findUniqueOrThrow({
    where: {
      id:
        current.kind === "movie"
          ? current.mediaId
          : current.coordinates.seriesId,
    },
  });
  const catalog = canonicalReferences(root);
  const references =
    release.sourceEvidence === null
      ? []
      : (CandidateSourceEvidenceSchema.parse(release.sourceEvidence)
          .references ?? []);
  if (referenceConflict(root, references))
    throw new MediaError(
      "external_identity_conflict",
      "Release identifiers conflict with current catalog",
      409,
    );
  const attributes = PublicReleaseAttributesSchema.parse(release.attributes);
  const media: Parameters<typeof matchRelease>[0]["media"] = {
    id: root.id,
    kind: root.kind,
    title: root.title,
    year: root.year,
    aliases: catalog.aliases,
    externalIds: Object.fromEntries(
      catalog.references.map((reference) => [
        reference.namespace,
        reference.value,
      ]),
    ),
  };
  if (current.kind === "series") {
    media.seriesTitle = root.title;
    if (root.year !== null) media.seriesYear = root.year;
  }
  const matchInput: Parameters<typeof matchRelease>[0] = {
    id: release.id,
    providerId: release.providerId,
    title: release.title,
    sizeBytes: attributes.sizeBytes,
    media,
    externalIds: Object.fromEntries(
      references.map((reference) => [reference.namespace, reference.value]),
    ),
    knownEpisodes:
      current.kind === "movie"
        ? []
        : current.coordinates.episodes.map((episode) => ({
            mediaId: episode.mediaId,
            season: episode.seasonNumber,
            episode: episode.episodeNumber,
            ...(episode.absoluteNumber === null
              ? {}
              : { absoluteNumber: episode.absoluteNumber }),
          })),
  };
  const matched =
    editionEvidence === undefined
      ? matchRelease(matchInput)
      : matchMovieReleaseV4(matchInput, editionEvidence);
  if (
    matched.attributes.identityConfidence !== "exact" ||
    identityHash([...matched.attributes.mediaIds].sort()) !==
      identityHash([...release.mediaIds].sort())
  )
    throw new MediaError(
      "automatic_identity_changed",
      "Release no longer matches current canonical identity; refresh or review its identity",
      409,
    );
}
