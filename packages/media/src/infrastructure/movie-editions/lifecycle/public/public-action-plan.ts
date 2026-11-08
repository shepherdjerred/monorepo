import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import type { MovieLifecycleCommandV4 } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import {
  MovieOwnerRemovalV1Schema,
  MovieOwnerRestoreV1Schema,
} from "#shared/movie-editions/lifecycle/owner-lifecycle-v1.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { movieOwnerRemovalConfirmationV1 } from "#infrastructure/movie-editions/lifecycle/owner-confirmation.ts";

export async function validateMovieActionFilesV4(
  tx: Prisma.TransactionClient,
  input: MovieLifecycleCommandV4,
  asset: { id: string; state: string } | undefined,
  budget: PublicationAuthorityReadBudget,
) {
  const action = input.command.action;
  if (action === "restore" && asset?.state !== "quarantined")
    throw new MediaError(
      "not_quarantined",
      "Only quarantined media can be restored",
      409,
    );
  if (
    action === "select_release" &&
    input.command.identityConfirmation !== undefined
  )
    throw new MediaError(
      "movie_release_identity_required",
      "Movie edition selection requires exact scoped release evidence",
      422,
    );
  if (action !== "remove") return;
  if (asset === undefined)
    throw new MediaError(
      "asset_unavailable",
      "No current video can be reviewed for removal",
      409,
    );
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id = ${asset.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE "assetId" = ${asset.id} ORDER BY id FOR UPDATE`;
  const snapshot = await snapshotMoviePublicationAssetV2(
    tx,
    input.scope,
    asset.id,
    budget,
  );
  if (
    identityHash(movieOwnerRemovalConfirmationV1(snapshot)) !==
    identityHash(input.command.confirmation)
  )
    throw new MediaError(
      "movie_removal_changed",
      "Review the current movie and captions before removal",
      409,
    );
}

export function movieActionIntentV4(
  action: MovieLifecycleCommandV4["command"]["action"],
  epoch: number,
): Prisma.MediaIntentUpdateInput {
  const renewal = ["remove", "restore", "select_release"].includes(action);
  return {
    version: { increment: 1 },
    ...(renewal
      ? { generation: { increment: 1 }, automationEpoch: epoch }
      : {}),
    ...(action === "remove"
      ? {
          desiredPresence: false,
          monitoring: false,
          libraryMonitoring: false,
          intentionallyRemovedAt: new Date(),
        }
      : {}),
    ...(action === "restore"
      ? {
          desiredPresence: true,
          monitoring: true,
          intentionallyRemovedAt: null,
        }
      : {}),
  };
}

export function movieActionOperationV4(
  input: MovieLifecycleCommandV4,
  source: {
    actorId: string;
    applied: {
      mediaVersion: number;
      targetVersion: number;
      generation: number;
      recoveryEpoch: number;
    };
  },
  authority: { owner: boolean; restoreForHold: boolean },
) {
  const action = input.command.action;
  let kind: string;
  if (action === "remove") kind = "retain_movie_edition_v4";
  else if (action === "restore" || authority.restoreForHold)
    kind = "restore_movie_edition_v4";
  else if (action === "select_release") kind = "acquire_movie_edition_v4";
  else return null;
  const original = { schemaVersion: 1, ...source, request: input };
  return {
    kind,
    mediaId: input.scope.mediaId,
    generation: source.applied.generation,
    details: {
      schemaVersion: 4,
      scope: input.scope,
      ...(action === "remove"
        ? { ownerRemovalV1: MovieOwnerRemovalV1Schema.parse(original) }
        : {}),
      ...(action === "restore" && authority.owner
        ? { ownerRestoreV1: MovieOwnerRestoreV1Schema.parse(original) }
        : {}),
      ...(action === "select_release"
        ? { releaseId: input.command.releaseId }
        : {}),
    },
  };
}
