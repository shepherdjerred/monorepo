import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { requestFulfillment } from "#automation/editions/fulfillment.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";

export function isReadiness(kind: string) {
  return ["media_available", "media_upgraded", "subtitles_ready"].includes(
    kind,
  );
}

export async function eligibleRequester(
  tx: Prisma.TransactionClient,
  input: {
    ownerOnly: boolean;
    userId: string;
    mediaId: string;
    mediaKind: string;
    eventKind: string;
    item: {
      language?: string | undefined;
      assetId?: string | undefined;
      assetVersion?: number | undefined;
    };
    movieAccess: MovieChoiceAccess | undefined;
    captureFreshness: ((guard: MovieChoiceFreshness) => void) | undefined;
  },
) {
  if (input.ownerOnly && !isReadiness(input.eventKind)) return true;
  const claim = await tx.mediaRequest.findFirst({
    where: {
      userId: input.userId,
      mediaId: input.mediaId,
      ...effectiveRequestWhere,
      edition: "default",
    },
  });
  if (
    claim === null ||
    (input.item.language !== undefined &&
      input.eventKind !== "subtitles_ready" &&
      !claim.subtitleLanguages.includes(input.item.language))
  )
    return false;
  if (!isReadiness(input.eventKind)) return true;
  const fulfillment = await requestFulfillment(tx, {
    kind: input.mediaKind,
    requestId: claim.id,
    currentAsset:
      input.item.assetId === undefined || input.item.assetVersion === undefined
        ? null
        : {
            assetId: input.item.assetId,
            assetVersion: input.item.assetVersion,
          },
    access: input.movieAccess,
    ...(input.captureFreshness === undefined
      ? {}
      : { captureFreshness: input.captureFreshness }),
  });
  return (
    fulfillment.status === "not_applicable" ||
    fulfillment.status === "fulfilled"
  );
}
