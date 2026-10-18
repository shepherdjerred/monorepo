import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import { readMovieRequestAuthority } from "#infrastructure/movie-editions/fulfillment.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";

export async function requestFulfillment(
  tx: Prisma.TransactionClient,
  input: {
    kind: string;
    requestId: string;
    currentAsset: { assetId: string; assetVersion: number } | null;
    access: MovieChoiceAccess | undefined;
    captureFreshness?: (freshness: MovieChoiceFreshness) => void;
  },
): Promise<MovieEditionFulfillment> {
  if (input.kind !== "movie") return { status: "not_applicable", reason: null };
  const authority = await readMovieRequestAuthority(tx, {
    requestId: input.requestId,
    currentAsset: input.currentAsset,
    access: requireMovieChoiceAccess(input.access ?? {}),
  });
  if (authority.freshness !== null)
    input.captureFreshness?.(authority.freshness);
  return authority.fulfillment;
}

export async function currentFulfillmentAsset(
  tx: Prisma.TransactionClient,
  mediaId: string,
) {
  const covered = await tx.assetCoverage.findMany({
    where: { mediaId, current: true, edition: "default" },
    include: { asset: true },
    take: 2,
  });
  if (covered.length > 1)
    throw new Error("Default target has multiple current physical assets");
  const asset = covered[0]?.asset;
  return asset === undefined
    ? null
    : { assetId: asset.id, assetVersion: asset.version };
}
