import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import {
  MovieTargetContextV4Schema,
  type MovieTargetContextV4,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  movieEditionDisplayLabel,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { movieChoiceSubject } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { canReadMovie } from "#infrastructure/movie-editions/view.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { movieOwnerRemovalConfirmationV1 } from "./owner-confirmation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  movieReadProtectionAccessV4,
  type MovieProtectionViewAccessV4,
} from "./public/public-access.ts";
import { moviePublicTargetAssetV4 } from "./public/public-asset.ts";
import { movieOperationalAdmissionV4 } from "./public/public-inventory.ts";
import { readMovieTargetProgressV4 } from "./public/public-progress.ts";
import { movieCaptionStatus } from "#infrastructure/quality-guide/movie-caption-status.ts";

export async function readMovieTargetContextV4(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: { scope: MovieEditionScope } & MovieProtectionViewAccessV4,
  budget = new PublicationAuthorityReadBudget(),
): Promise<MovieTargetContextV4> {
  const { scope, access } = input;
  const { media, target } = await lockMovieCommand(tx, scope, {
    personalProtection: true,
  });
  if (target === null)
    throw new MediaError(
      "movie_target_not_found",
      "Choose this edition before managing its lifecycle",
      404,
    );
  const identity = await movieChoiceSubject(tx, {
    actorId: actor.id,
    subjectUserId: actor.id,
    purpose: "protect",
    access: movieReadProtectionAccessV4(input),
  });
  const owner = identity.actor.role === "owner" && !identity.actor.restricted;
  const controls = await ownMovieControlsV4(tx, actor.id, scope, owner);
  const common = {
    schemaVersion: 4,
    scope,
    expected: { mediaVersion: media.version, targetVersion: target.version },
    ownRequests: controls.ownRequests,
    ownHold: controls.ownHold,
    allowedProtectiveActions: controls.actions,
  };
  if (
    access === null ||
    target.editionRootId === null ||
    !canReadMovie(identity, media.externalIds, access)
  ) {
    if (
      !owner &&
      controls.ownRequests.length === 0 &&
      controls.ownHold === null
    )
      throw new MediaError(
        "movie_protection_scope_not_found",
        "No personal request or hold is available in this scope",
        404,
      );
    return MovieTargetContextV4Schema.parse({
      ...common,
      access: "protection_only",
    });
  }
  const admission = await movieTargetAdmissionV4(
    tx,
    { scope, target, actorId: actor.id },
    budget,
  );
  const asset = await currentMovieAssetV4(tx, scope);
  const confirmation =
    owner && asset?.state === "published"
      ? movieOwnerRemovalConfirmationV1(
          await snapshotMoviePublicationAssetV2(tx, scope, asset.id, budget),
        )
      : null;
  const allowedActions = movieTargetActionsV4({
    owner,
    active: controls.active,
    protective: controls.actions,
    enabled: admission.enabled,
    libraryMonitoring: target.libraryMonitoring,
    state: asset?.state ?? null,
    canRemove: confirmation !== null,
    canRetry: admission.canRetry,
    canSelect: admission.canSelect,
    personalDemand: admission.personalDemand,
  });
  const progress = await readMovieTargetProgressV4(
    tx,
    { scope, epoch: admission.epoch, owner, ownDemand: controls.active },
    budget,
  );
  identity.freshness?.assertActive();
  return MovieTargetContextV4Schema.parse({
    ...common,
    access: "detail",
    title: media.title,
    year: media.year,
    editionLabel: movieEditionDisplayLabel(scope.edition),
    target: {
      generation: target.generation,
      availability: target.availability,
      desiredPresence: target.desiredPresence,
      monitoring: target.monitoring,
      libraryMonitoring: target.libraryMonitoring,
    },
    allowedActions,
    reasons: admission.reasons,
    removalConfirmation: confirmation,
    currentAsset: moviePublicTargetAssetV4(
      asset,
      admission.epoch,
      await movieCaptionStatus(
        tx,
        {
          profileId: target.profileId,
          originalLanguage: media.originalLanguage,
          scope,
          asset,
          epoch: admission.epoch,
        },
        budget,
      ),
    ),
    progress,
  });
}

async function ownMovieControlsV4(
  tx: Prisma.TransactionClient,
  userId: string,
  scope: MovieEditionScope,
  owner: boolean,
) {
  const requests = await tx.mediaRequest.findMany({
    where: { mediaId: scope.mediaId, edition: scope.edition, userId },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (requests.length > 100)
    throw new MediaError(
      "movie_request_limit",
      "Movie request inventory exceeds its scope bound",
      409,
    );
  const ownRequests = requests.map((row) => ({
    id: row.id,
    version: row.version,
    active: row.active && !row.excluded,
    choiceId: row.movieEditionChoiceId,
    choiceRevision: row.movieEditionChoiceRevision,
    canCancel: row.active && !row.excluded,
    canRevokeChoice:
      row.active && !row.excluded && row.movieEditionChoiceId !== null,
  }));
  const ownHold = await tx.retentionHold.findUnique({
    where: {
      userId_mediaId_edition: {
        userId,
        mediaId: scope.mediaId,
        edition: scope.edition,
      },
    },
  });
  const active = requests.some(
    (row) => row.active && !row.excluded && row.direct,
  );
  const actions: string[] = [];
  if (owner || active) actions.push("keep");
  if (owner) actions.push("pin", "unpin");
  if (ownRequests.some((row) => row.canCancel)) actions.push("cancel_request");
  if (ownRequests.some((row) => row.canRevokeChoice))
    actions.push("revoke_choice");
  return {
    ownRequests,
    ownHold:
      ownHold === null
        ? null
        : { isPin: ownHold.isPin, until: ownHold.until?.toISOString() ?? null },
    active,
    actions,
  };
}

async function movieTargetAdmissionV4(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    target: { generation: number; profileId: string | null };
    actorId: string;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const runtime = await runtimeAuthority(tx);
  const reasons: string[] = [];
  if (!runtime.active) reasons.push("runtime_protected");
  if (input.target.profileId === null) reasons.push("quality_profile_required");
  const inventory = await movieOperationalAdmissionV4(
    tx,
    {
      scope: input.scope,
      generation: input.target.generation,
      actorId: input.actorId,
    },
    budget,
  );
  if (inventory.recoveryHeld) reasons.push("recovery_hold");
  if (inventory.reserved) reasons.push("acquisition_active");
  return {
    reasons,
    enabled: runtime.active && !inventory.recoveryHeld,
    epoch: runtime.epoch,
    canRetry: input.target.profileId !== null && inventory.retryable,
    canSelect: input.target.profileId !== null && !inventory.reserved,
    personalDemand: inventory.personalDemand,
  };
}

async function currentMovieAssetV4(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
) {
  const assets = await tx.assetCoverage.findMany({
    where: { mediaId: scope.mediaId, edition: scope.edition, current: true },
    include: {
      asset: {
        include: {
          subtitles: {
            where: { state: { in: ["installed", "quarantined"] } },
            orderBy: { id: "asc" },
            take: 101,
          },
        },
      },
    },
    take: 2,
  });
  if (assets.length > 1)
    throw new Error("Movie target has multiple current video assets");
  return assets[0]?.asset;
}

function movieTargetActionsV4(input: {
  owner: boolean;
  active: boolean;
  protective: string[];
  enabled: boolean;
  libraryMonitoring: boolean;
  state: string | null;
  canRemove: boolean;
  canRetry: boolean;
  canSelect: boolean;
  personalDemand: boolean;
}) {
  const actions = input.protective.filter((action) =>
    ["keep", "pin", "unpin"].includes(action),
  );
  if (!input.enabled) return actions;
  if (input.state === "quarantined" && (input.owner || input.active))
    actions.push("restore");
  if (input.canRemove) actions.push("remove");
  if (input.canRetry) actions.push("retry");
  if (
    input.canSelect &&
    input.owner &&
    (input.personalDemand || input.libraryMonitoring)
  )
    actions.push("select_release");
  return actions;
}
