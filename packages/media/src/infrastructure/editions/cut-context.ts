import { z } from "zod";
import type { Prisma, ReleaseCandidate } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { parseCutEvidence } from "#domain/editions/parse.ts";
import type {
  CutCanonical,
  CutEvidence,
  EditionText,
} from "#shared/editions/evidence.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import {
  identityHash,
  numberingOf,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";

export async function cutCanonical(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<CutCanonical> {
  const ids = z.array(z.uuid()).min(1).max(100).parse(mediaIds);
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: { parent: { include: { parent: true } } },
    orderBy: { id: "asc" },
  });
  if (rows.length !== ids.length)
    throw new MediaError(
      "identity_coverage_changed",
      "Cut assessment coverage changed",
      409,
    );
  const roots = rows.map((row) => {
    if (row.kind === "movie") return row;
    if (row.kind !== "episode") return null;
    if (row.parent?.kind === "series") return row.parent;
    return row.parent?.kind === "season" && row.parent.parent?.kind === "series"
      ? row.parent.parent
      : null;
  });
  const root = roots[0];
  if (root == null || roots.some((item) => item?.id !== root.id))
    throw new MediaError(
      "lineage_unresolved",
      "Cut assessment needs one canonical movie or series",
      409,
    );
  const value = {
    rootMediaId: root.id,
    title: root.title,
    aliases: canonicalReferences(root).aliases,
    episodeTitles: rows
      .filter((row) => row.kind === "episode")
      .map((row) => ({
        title: row.title,
        seasonNumber: z.int().nonnegative().parse(row.seasonNumber),
        episodeNumber: z.int().nonnegative().parse(row.episodeNumber),
        absoluteNumber: numberingOf(row).absoluteNumber,
      })),
  };
  return { ...value, digest: identityHash(value) };
}

export function releaseCut(
  release: ReleaseCandidate,
  canonical: CutCanonical,
): CutEvidence {
  const source =
    release.sourceEvidence === null
      ? null
      : CandidateSourceEvidenceSchema.parse(release.sourceEvidence);
  const texts = [
    {
      text: release.title,
      provenance: {
        kind: "release-title" as const,
        field: "retained.primaryTitle",
      },
    },
    ...(source?.editionEvidence ?? []),
  ];
  return parseCutEvidence({
    source: {
      kind: "provider",
      providerId: release.providerId,
      providerReleaseId: release.providerReleaseId,
    },
    sourceDigest: identityHash({
      id: release.id,
      title: release.title,
      source: release.sourceEvidence,
    }),
    canonical,
    attribution:
      source?.editionEvidence === undefined
        ? "legacy_primary"
        : "provider_texts",
    texts,
  });
}

/** Retained original facts only. Handoff's measured title is a library basename. */
export async function currentCuts(
  tx: Prisma.TransactionClient,
  canonical: CutCanonical,
  input: {
    mediaIds: readonly string[];
    predecessorAssetIds?: readonly string[];
  },
): Promise<CutEvidence[]> {
  const assets = await tx.libraryAsset.findMany({
    where: {
      OR: [
        {
          coverage: {
            some: {
              mediaId: { in: [...input.mediaIds] },
              edition: "default",
              current: true,
            },
          },
        },
        { id: { in: [...(input.predecessorAssetIds ?? [])] } },
      ],
    },
    orderBy: { id: "asc" },
  });
  const result: CutEvidence[] = [];
  assertPredecessorPresence(assets, input.predecessorAssetIds);
  for (const asset of assets) {
    const properties = z
      .looseObject({
        title: z.string().optional(),
        releaseId: z.uuid().optional(),
        resolvedEvidence: z
          .looseObject({ parserVersion: z.string() })
          .optional(),
      })
      .parse(asset.properties);
    const texts: EditionText[] = [];
    if (hasOriginalTitle(properties))
      texts.push({
        text: z.string().parse(properties.title),
        provenance: {
          kind: "release-title",
          field: "retained.properties.title",
        },
      });
    const originalPath =
      asset.sourcePath !== null && asset.sourcePath !== asset.path
        ? asset.sourcePath
        : null;
    if (originalPath !== null)
      result.push(
        parseCutEvidence({
          source: {
            kind: "legacy_asset",
            assetId: asset.id,
            assetVersion: asset.version,
          },
          sourceDigest: identityHash({
            assetId: asset.id,
            checksum: asset.checksum,
            originalPath,
          }),
          canonical,
          attribution: "torrent_member",
          texts: [
            {
              text: originalPath,
              provenance: {
                kind: "release-title",
                field: "retained.sourcePath",
              },
            },
          ],
        }),
      );
    if (properties.releaseId !== undefined) {
      const release = await tx.releaseCandidate.findUniqueOrThrow({
        where: { id: properties.releaseId },
      });
      result.push(releaseCut(release, canonical));
    }
    if (
      originalPath === null &&
      properties.releaseId === undefined &&
      texts.length === 0
    )
      throw new MediaError(
        "edition_provenance_missing",
        "Current file needs original cut provenance before replacement",
        409,
      );
    if (texts.length > 0)
      result.push(
        parseCutEvidence({
          source: {
            kind: "legacy_asset",
            assetId: asset.id,
            assetVersion: asset.version,
          },
          sourceDigest: identityHash({
            assetId: asset.id,
            checksum: asset.checksum,
            texts,
          }),
          canonical,
          attribution: "legacy_primary",
          texts,
        }),
      );
  }
  return result;
}

function assertPredecessorPresence(
  assets: readonly { id: string }[],
  predecessorIds: readonly string[] = [],
): void {
  if (predecessorIds.some((id) => !assets.some((asset) => asset.id === id)))
    throw new MediaError(
      "edition_provenance_missing",
      "Reviewed predecessor cut provenance is missing",
      409,
    );
}

function hasOriginalTitle(properties: {
  title?: string | undefined;
  resolvedEvidence?: { parserVersion: string } | undefined;
}): boolean {
  return (
    properties.title !== undefined &&
    properties.resolvedEvidence?.parserVersion !== "handoff-v1"
  );
}
