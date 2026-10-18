import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { RecoveryScope } from "#shared/recovery.ts";
import {
  RecoveryStoredResponseSchema,
  respondentMediaIds,
} from "#shared/recovery.ts";
import {
  applyHold,
  invalidateRetention,
} from "#infrastructure/action-guards.ts";
import { needsRestore } from "#infrastructure/locks.ts";
import { queueOperation } from "#automation/store.ts";
import { recoveryConflict } from "./scope.ts";
import { pendingCompensationGroups } from "#infrastructure/native-compensation/routing.ts";

export async function applyRecoveryDeclarations(
  db: Prisma.TransactionClient,
  input: {
    reviewId: string;
    scope: RecoveryScope;
    responses: { userId: string; response: unknown }[];
  },
) {
  const restoring = new Set<string>();
  for (const row of input.responses) {
    for (const mediaId of await applyRespondent(db, input.scope, row))
      restoring.add(mediaId);
  }
  for (const media of input.scope.media) {
    await db.mediaItem.update({
      where: { id: media.id },
      data: { version: { increment: 1 } },
    });
    // An exact native physical receipt plus fresh positive household declarations
    // authorizes a new intent; historical attempts/deliveries keep their birth epoch.
    const covered = input.scope.assets.filter((asset) =>
      asset.mediaIds.includes(media.id),
    );
    const nativeIds = new Set(
      input.scope.nativeReceipts.flatMap((receipt) => receipt.assetIds),
    );
    const renew =
      restoring.has(media.id) &&
      covered.length > 0 &&
      covered.every((asset) => nativeIds.has(asset.id));
    const intent = await db.mediaIntent.update({
      where: targetWhere(defaultScope(media.id)),
      data: {
        generation: { increment: 1 },
        version: { increment: 1 },
        monitoring: restoring.has(media.id),
        ...(renew ? { automationEpoch: input.scope.recoveryEpoch } : {}),
        ...(restoring.has(media.id)
          ? { desiredPresence: true, intentionallyRemovedAt: null }
          : {}),
      },
    });
    await invalidateRetention(db, media.id);
    await db.watchState.deleteMany({
      where: { edition: "default", mediaId: media.id },
    });
    if (await queueRestoredMedia(db, media.id, restoring))
      await queueOperation(db, {
        key: `recovery-restore:${input.reviewId}:${media.id}`,
        kind: (await needsRestore(db, media.id))
          ? "restore_media"
          : "reconcile_media",
        targetId: media.id,
        payload: { mediaId: media.id, generation: intent.generation },
      });
  }
}

async function applyRespondent(
  db: Prisma.TransactionClient,
  scope: RecoveryScope,
  row: { userId: string; response: unknown },
) {
  const response = RecoveryStoredResponseSchema.parse(row.response);
  const permitted = respondentMediaIds(scope, row.userId);
  const declared = response.declarations.map((item) => item.mediaId);
  if (
    new Set(declared).size !== declared.length ||
    declared.length !== permitted.length ||
    declared.some((id) => !permitted.includes(id))
  )
    throw recoveryConflict(
      "Response must declare exactly the subject's reviewed leaves",
    );
  const user = await db.mediaUser.findUniqueOrThrow({
    where: { id: row.userId },
  });
  const restoring = [];
  for (const declaration of response.declarations) {
    const mediaId = declaration.mediaId;
    if (!scope.media.some((media) => media.id === mediaId))
      throw recoveryConflict("Response includes unreviewed media");
    const wants = declaration.intent !== "no_longer_request";
    const item = scope.media.find((media) => media.id === mediaId);
    const clearsMovieChoice = !wants && item?.kind === "movie";
    await db.mediaRequest.upsert({
      where: {
        userId_mediaId_edition: {
          edition: "default",
          userId: row.userId,
          mediaId,
        },
      },
      create: {
        userId: row.userId,
        mediaId,
        active: wants,
        direct: true,
        excluded: !wants,
      },
      update: {
        active: wants,
        direct: true,
        excluded: !wants,
        version: { increment: 1 },
        ...(clearsMovieChoice
          ? {
              movieEditionChoiceId: null,
              movieEditionChoiceRevision: { increment: 1 },
            }
          : {}),
      },
    });
    if (declaration.intent === "keep")
      await applyHold(db, user, mediaId, {
        action: "keep",
        keepDays: declaration.days,
      });
    if (wants) restoring.push(mediaId);
  }
  return restoring;
}

export function responseProjection(
  rows: {
    userId: string;
    actorId: string;
    response: unknown;
    createdAt: Date;
  }[],
) {
  return rows.map((row) => ({
    userId: row.userId,
    actorId: row.actorId,
    response: RecoveryStoredResponseSchema.parse(row.response),
    createdAt: row.createdAt.toISOString(),
  }));
}

export function responseJson(rows: Parameters<typeof responseProjection>[0]) {
  return z.json().parse(responseProjection(rows));
}

async function queueRestoredMedia(
  db: Prisma.TransactionClient,
  mediaId: string,
  restoring: ReadonlySet<string>,
) {
  if (!restoring.has(mediaId)) return false;
  const groups = await pendingCompensationGroups(db, [mediaId]);
  return groups.length === 0;
}
