import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import {
  cutCanonical,
  currentCuts,
} from "#infrastructure/editions/cut-context.ts";
import { evaluateDefaultCut } from "#domain/editions/selection.ts";
import { readMovieChoice } from "./authority.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { readQuarantinedPlexWatchAuthority } from "#infrastructure/plex-binding/quarantine.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import { lockMovieChoiceIdentities, type MovieChoiceAccess } from "./access.ts";
import type { MovieChoiceFreshness } from "./freshness.ts";
import { movieCutFulfillmentV2 } from "./fulfillment-v2.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export type MovieFulfillmentAsset = {
  assetId: string;
  assetVersion: number;
} | null;
type RequestInput = {
  requestId: string;
  currentAsset: MovieFulfillmentAsset;
  access: MovieChoiceAccess;
  expectedScope?: MovieEditionScope;
  budget?: PublicationAuthorityReadBudget;
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
    ...(input.expectedScope === undefined
      ? {}
      : { expectedScope: input.expectedScope }),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
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
  if (input.currentAsset === null)
    return choice.scope.edition === "default"
      ? {
          status: "pending_asset",
          reason: "movie_edition_asset_unavailable",
        }
      : {
          status: "pending_edition",
          reason: "edition_acquisition_not_ready",
        };
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: input.currentAsset.assetId },
    include: { coverage: { where: { current: true } } },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    choice.scope.edition !== "default" &&
    asset.state !== "quarantined" &&
    !(await hasMovieEditionBindingV2(tx, input, choice))
  )
    return {
      status: "pending_edition",
      reason: "edition_acquisition_not_ready",
    };
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
  if (!(await hasVerifiedAssociation(tx, input, choice, asset)))
    return {
      status: "pending_asset",
      reason: "movie_edition_asset_unavailable",
    };
  return choice.scope.edition === "default"
    ? matchingCut(tx, choice.scope.mediaId, asset.id, input.budget)
    : movieCutFulfillmentV2(tx, choice.scope, asset.id, input.budget);
}

async function hasMovieEditionBindingV2(
  tx: Prisma.TransactionClient,
  input: RequestInput,
  choice: AuthorizedChoice,
) {
  if (input.currentAsset === null) return false;
  const current = await readCurrentPlexBinding(
    tx,
    {
      scope: { mediaId: choice.scope.mediaId, edition: choice.scope.edition },
      assetId: input.currentAsset.assetId,
      access: {
        serverMachineId: input.access.serverMachineId,
        sectionId: input.access.movieSectionId,
        sectionType: "movie",
      },
    },
    input.budget,
  );
  return (
    current.status === "current" && current.association.schemaVersion === 2
  );
}

async function hasVerifiedAssociation(
  tx: Prisma.TransactionClient,
  input: RequestInput,
  choice: AuthorizedChoice,
  asset: { id: string; state: string },
): Promise<boolean> {
  const access: PlexAccess = {
    serverMachineId: input.access.serverMachineId,
    sectionId: input.access.movieSectionId,
    sectionType: "movie",
  };
  const scope = {
    mediaId: choice.scope.mediaId,
    edition: choice.scope.edition,
  };
  if (asset.state === "published") {
    const current = await readCurrentPlexBinding(
      tx,
      {
        scope,
        assetId: asset.id,
        access,
      },
      input.budget,
    );
    return current.status === "current";
  }
  const decisions = await tx.retentionDecision.findMany({
    where: { ...scope, state: "quarantined" },
    select: { id: true },
    take: 2,
  });
  input.budget?.consume(decisions.length);
  const decision = decisions[0];
  if (decision === undefined || decisions.length !== 1) return false;
  const quarantined = await readQuarantinedPlexWatchAuthority(
    tx,
    {
      decisionId: decision.id,
      scope,
      assetId: asset.id,
      access,
    },
    input.budget,
  );
  return (
    quarantined.status === "current" &&
    (choice.scope.edition === "default" ||
      quarantined.association.schemaVersion === 2)
  );
}

async function matchingCut(
  tx: Prisma.TransactionClient,
  mediaId: string,
  assetId: string,
  budget?: PublicationAuthorityReadBudget,
): Promise<MovieEditionFulfillment> {
  try {
    const canonical = await cutCanonical(tx, [mediaId]);
    const evidence = await currentCuts(tx, canonical, {
      mediaIds: [mediaId],
      predecessorAssetIds: [assetId],
      ...(budget === undefined ? {} : { budget }),
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
    scope?: MovieEditionScope;
    budget?: PublicationAuthorityReadBudget;
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
  const scope =
    input.scope === undefined
      ? undefined
      : MovieEditionScopeSchema.parse(input.scope);
  if (
    scope !== undefined &&
    (scope.mediaId !== media.id || scope.rootMediaId !== media.id)
  )
    throw new Error("Movie retention demand differs from its exact scope");
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: media.id,
      ...(scope === undefined ? {} : { edition: scope.edition }),
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
      ...(scope === undefined ? {} : { expectedScope: scope }),
      ...(input.budget === undefined ? {} : { budget: input.budget }),
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
          expiresAtMs: Math.min(...guards.map((guard) => guard.expiresAtMs)),
          assertActive: () => {
            for (const guard of guards) guard.assertActive();
          },
        };
  freshness?.assertActive();
  return { demands, freshness };
}
