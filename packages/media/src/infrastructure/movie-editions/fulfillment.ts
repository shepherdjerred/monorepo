import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import {
  cutCanonical,
  currentCuts,
} from "#infrastructure/editions/cut-context.ts";
import { evaluateDefaultCut } from "#domain/editions/selection.ts";
import { readMovieChoice } from "./authority.ts";
import { compensationPlayback } from "#infrastructure/native-compensation/playback.ts";
import { lockMovieChoiceIdentities, type MovieChoiceAccess } from "./access.ts";
import type { MovieChoiceFreshness } from "./freshness.ts";

export type MovieFulfillmentAsset = {
  assetId: string;
  assetVersion: number;
} | null;
type RequestInput = {
  requestId: string;
  currentAsset: MovieFulfillmentAsset;
  access: MovieChoiceAccess;
};
type AuthorizedChoice = Extract<
  Awaited<ReturnType<typeof readMovieChoice>>,
  { status: "authorized" }
>;
type RequestAuthority = {
  fulfillment: MovieEditionFulfillment;
  freshness: MovieChoiceFreshness | null;
};

/** Matching demand is separate from playback. Quarantined current bytes can still match. */
export async function readMovieRequestFulfillment(
  tx: Prisma.TransactionClient,
  input: RequestInput,
): Promise<MovieEditionFulfillment> {
  const authority = await readMovieRequestAuthority(tx, input);
  return authority.fulfillment;
}

/** Effect callers retain this transient guard through their last awaited boundary. */
export async function readMovieRequestAuthority(
  tx: Prisma.TransactionClient,
  input: RequestInput,
): Promise<RequestAuthority> {
  const choice = await readMovieChoice(tx, {
    requestId: input.requestId,
    access: input.access,
  });
  if (choice.status === "not_applicable")
    return {
      fulfillment: { status: "not_applicable", reason: null },
      freshness: null,
    };
  if (choice.status === "protected")
    return {
      fulfillment:
        choice.reason === "movie_edition_choice_required"
          ? { status: "pending_choice", reason: choice.reason }
          : { status: "protected", reason: choice.reason },
      freshness: null,
    };
  const fulfillment = await matchingAsset(tx, input, choice);
  choice.freshness.assertActive();
  return { fulfillment, freshness: choice.freshness };
}

async function matchingAsset(
  tx: Prisma.TransactionClient,
  input: RequestInput,
  choice: AuthorizedChoice,
): Promise<MovieEditionFulfillment> {
  if (choice.scope.edition !== "default")
    return {
      status: "pending_edition",
      reason: "edition_acquisition_not_ready",
    };
  if (input.currentAsset === null)
    return {
      status: "pending_asset",
      reason: "movie_edition_asset_unavailable",
    };
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: input.currentAsset.assetId },
    include: { coverage: { where: { current: true } } },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    asset.version !== input.currentAsset.assetVersion ||
    asset.edition !== choice.scope.edition ||
    asset.editionRootId !== choice.scope.rootMediaId ||
    !asset.owned ||
    asset.checksum === null ||
    asset.ownershipEpoch !== runtime.recoveryEpoch ||
    !["published", "quarantined"].includes(asset.state) ||
    asset.coverage.length !== 1 ||
    asset.coverage[0]?.mediaId !== choice.scope.mediaId ||
    asset.coverage[0].edition !== choice.scope.edition
  )
    return { status: "protected", reason: "movie_edition_asset_mismatch" };
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: choice.scope.mediaId },
  });
  const playback = await compensationPlayback(tx, {
    mediaId: media.id,
    recoveryEpoch: runtime.recoveryEpoch,
    serverMachineId: input.access.serverMachineId,
    externalIds: media.externalIds,
  });
  const binding = z
    .object({
      plexRatingKey: z.string().min(1).optional(),
      plexSectionId: z.string().min(1).optional(),
    })
    .parse(media.externalIds);
  if (
    playback.state === "protected" ||
    (playback.state === "ordinary" && asset.plexPublishedAt === null) ||
    binding.plexRatingKey === undefined ||
    binding.plexSectionId !== input.access.movieSectionId
  )
    return {
      status: "pending_asset",
      reason: "movie_edition_asset_unavailable",
    };
  return matchingCut(tx, choice.scope.mediaId, asset.id);
}

async function matchingCut(
  tx: Prisma.TransactionClient,
  mediaId: string,
  assetId: string,
): Promise<MovieEditionFulfillment> {
  try {
    const canonical = await cutCanonical(tx, [mediaId]);
    const evidence = await currentCuts(tx, canonical, {
      mediaIds: [mediaId],
      predecessorAssetIds: [assetId],
    });
    const candidate = evidence[0];
    if (candidate === undefined)
      throw new Error("Current movie cut evidence is empty");
    const decision = evaluateDefaultCut({
      candidate,
      current: evidence.slice(1),
    });
    if (!decision.accepted)
      return {
        status: "protected",
        reason: decision.reasons[0] ?? "movie_edition_asset_mismatch",
      };
  } catch (error) {
    if (
      error instanceof MediaError &&
      error.code === "edition_provenance_missing"
    )
      return { status: "protected", reason: "movie_edition_asset_mismatch" };
    throw error;
  }
  return { status: "fulfilled", reason: null };
}

/** Complete protective cohort, including owners and every named pending target. No truncation. */
export async function readMovieDemandFulfillment(
  tx: Prisma.TransactionClient,
  input: {
    mediaId: string;
    currentAsset: MovieFulfillmentAsset;
    access: MovieChoiceAccess;
  },
) {
  const authority = await readMovieDemandAuthority(tx, input);
  return authority.demands;
}

/** Every current actor in the complete protective cohort bounds a later effect. */
export async function readMovieDemandAuthority(
  tx: Prisma.TransactionClient,
  input: {
    mediaId: string;
    currentAsset: MovieFulfillmentAsset;
    access: MovieChoiceAccess;
  },
) {
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.mediaId },
  });
  const demands: {
    requestId: string;
    userId: string;
    edition: string;
    fulfillment: MovieEditionFulfillment;
  }[] = [];
  if (media.kind !== "movie") return { demands, freshness: null };
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: media.id,
      OR: [
        effectiveRequestWhere,
        {
          edition: { not: "default" },
          active: true,
          excluded: false,
          direct: true,
        },
      ],
    },
    orderBy: { id: "asc" },
  });
  await lockMovieChoiceIdentities(tx, { mediaIds: [media.id] });
  const guards: MovieChoiceFreshness[] = [];
  for (const request of requests) {
    const authority = await readMovieRequestAuthority(tx, {
      requestId: request.id,
      currentAsset: input.currentAsset,
      access: input.access,
    });
    demands.push({
      requestId: request.id,
      userId: request.userId,
      edition: request.edition,
      fulfillment: authority.fulfillment,
    });
    if (authority.freshness !== null) guards.push(authority.freshness);
  }
  const freshness =
    guards.length === 0
      ? null
      : {
          assertActive: () => {
            for (const guard of guards) guard.assertActive();
          },
        };
  freshness?.assertActive();
  return { demands, freshness };
}
