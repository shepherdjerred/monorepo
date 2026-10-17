import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { MediaAction } from "#shared/contract.ts";
import { effectiveRequestWhere } from "./request-claims.ts";
import { authorizeRequester } from "./requester-authorization.ts";
import { defaultScope, assertDefaultEdition } from "#shared/editions/scope.ts";
import { readDefaultTarget } from "./editions/targets.ts";

/** Caller locks media/claims and runtime first; retain current identity through commit. */
export async function authorizeRenewal(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  input: {
    mediaId: string;
    action: "retry" | "select_release";
    serverMachineId?: string;
  },
): Promise<MediaActor> {
  const media = await db.mediaItem.findUnique({ where: { id: input.mediaId } });
  if (media === null)
    throw new MediaError("media_not_found", "Media item does not exist", 404);
  const { plexSectionId } = z
    .object({ plexSectionId: z.string().min(1).optional() })
    .parse(media.externalIds);
  const current = await authorizeRequester(db, actor, actor.id, {
    kind: media.kind,
    ...(plexSectionId === undefined ? {} : { sectionId: plexSectionId }),
    ...(input.serverMachineId === undefined
      ? {}
      : { serverMachineId: input.serverMachineId }),
  });
  if (input.action === "select_release") requireOwner(current);
  return current;
}

export async function validateAction(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  mediaId: string,
  input: MediaAction,
): Promise<void> {
  const media = await db.mediaItem.findUnique({ where: { id: mediaId } });
  if (media === null)
    throw new MediaError("media_not_found", "Media item does not exist", 404);
  if (actor.role !== "owner") {
    const claim = await db.mediaRequest.findFirst({
      where: { userId: actor.id, mediaId, ...effectiveRequestWhere },
    });
    if (claim?.active !== true)
      throw new MediaError(
        "request_required",
        "An active request is required for this action",
        403,
      );
  }
  const target = await readDefaultTarget(db, defaultScope(mediaId));
  if (input.action === "restore" && target.availability !== "quarantined")
    throw new MediaError(
      "not_quarantined",
      "Only quarantined media can be restored",
      409,
    );
  if (input.action === "select_release") {
    const release = await db.releaseCandidate.findUnique({
      where: { id: input.releaseId },
    });
    if (
      release?.mediaIds.includes(mediaId) !== true &&
      input.identityConfirmation === undefined
    )
      throw new MediaError(
        "invalid_release",
        "Release does not cover this media item",
        422,
      );
  }
}

export async function applyHold(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  mediaId: string,
  options: { action: MediaAction["action"]; keepDays: number },
): Promise<void> {
  if (options.action === "unpin") {
    await db.retentionHold.deleteMany({
      where: { userId: actor.id, ...defaultScope(mediaId), isPin: true },
    });
    return;
  }
  if (options.action !== "keep" && options.action !== "pin") return;
  const previous = await db.retentionHold.findUnique({
    where: {
      userId_mediaId_edition: { userId: actor.id, ...defaultScope(mediaId) },
    },
  });
  const until = new Date(Date.now() + options.keepDays * 86_400_000);
  const isPin = options.action === "pin" || previous?.isPin === true;
  const previousUntil = previous?.until;
  const effectiveUntil =
    previousUntil !== undefined &&
    previousUntil !== null &&
    previousUntil > until
      ? previousUntil
      : until;
  await db.retentionHold.upsert({
    where: {
      userId_mediaId_edition: { userId: actor.id, ...defaultScope(mediaId) },
    },
    create: { userId: actor.id, mediaId, isPin, until: isPin ? null : until },
    update: { isPin, until: isPin ? null : effectiveUntil },
  });
}

export function actionIntentChange(action: MediaAction["action"]) {
  if (action === "remove")
    return {
      desiredPresence: false,
      monitoring: false,
      intentionallyRemovedAt: new Date(),
    };
  return action === "restore"
    ? { desiredPresence: true, monitoring: true, intentionallyRemovedAt: null }
    : {};
}

export function initialActionIntent(action: MediaAction["action"]) {
  return {
    desiredPresence: action !== "remove",
    monitoring: action !== "remove",
    intentionallyRemovedAt: action === "remove" ? new Date() : null,
  };
}

export function actionCommand(action: MediaAction["action"]): string {
  if (action === "remove") return "retain_media";
  if (action === "restore") return "restore_media";
  return action === "select_release" ? "acquire_release" : "reconcile_media";
}

export async function sponsorClaim(
  db: Prisma.TransactionClient,
  userId: string,
  requestId: string,
  input: { mediaId: string; subtitleLanguages: string[] },
): Promise<void> {
  const existing = await db.mediaRequest.findUnique({
    where: {
      userId_mediaId_edition: { userId, ...defaultScope(input.mediaId) },
    },
  });
  if (existing?.excluded === true)
    throw new MediaError(
      "request_excluded",
      "Pack includes an explicitly cancelled episode",
      409,
    );
  const sponsor = await db.mediaRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      coverageSources: {
        where: {
          edition: "default",
          active: true,
          rootRequest: {
            edition: "default",
            active: true,
            direct: true,
            excluded: false,
          },
        },
        include: { rootRequest: true },
      },
    },
  });
  assertDefaultEdition(sponsor.edition);
  const roots = sponsor.direct
    ? [sponsor]
    : sponsor.coverageSources.map((source) => source.rootRequest);
  if (roots.length === 0)
    throw new MediaError(
      "sponsor_inactive",
      "Pack sponsor no longer has authority",
      409,
    );
  const claim = await db.mediaRequest.upsert({
    where: {
      userId_mediaId_edition: { userId, ...defaultScope(input.mediaId) },
    },
    create: { userId, ...input, direct: false, sponsorRequestId: requestId },
    update: {
      active: true,
      subtitleLanguages: input.subtitleLanguages,
      sponsorRequestId: requestId,
      version: { increment: 1 },
    },
  });
  for (const root of roots) {
    if (root.id === claim.id) continue;
    await db.requestCoverage.upsert({
      where: {
        rootRequestId_mediaId: {
          rootRequestId: root.id,
          mediaId: input.mediaId,
        },
      },
      create: {
        rootRequestId: root.id,
        requestId: claim.id,
        mediaId: input.mediaId,
        sourceVersion: root.version,
      },
      update: { active: true, sourceVersion: root.version },
    });
  }
}

export async function invalidateRetention(
  db: Prisma.TransactionClient,
  mediaId: string,
): Promise<void> {
  await db.retentionDecision.updateMany({
    where: {
      mediaId,
      edition: "default",
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: { state: "cancelled", version: { increment: 1 } },
  });
}
