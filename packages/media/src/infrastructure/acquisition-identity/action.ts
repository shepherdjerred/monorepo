import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaAction } from "#shared/contract.ts";
import type { MediaCommandSettings } from "#infrastructure/command-base.ts";
import {
  lockCanonicalMedia,
  lockExistingDefaultTargets,
  lockDefaultScopes,
} from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import { authorizeRenewal } from "#infrastructure/action-guards.ts";
import { confirmIdentity } from "./decision.ts";
import { assertAutomaticIdentity } from "./automatic.ts";
import { identityHash } from "./snapshot.ts";
import { MediaError } from "#application/errors.ts";

export async function prepareActionAuthority(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  options: {
    mediaId: string;
    input: MediaAction;
    settings: MediaCommandSettings;
  },
) {
  const { mediaId, input, settings } = options;
  const automatic =
    input.action === "select_release" &&
    input.identityConfirmation === undefined
      ? await tx.releaseCandidate.findUniqueOrThrow({
          where: { id: input.releaseId },
        })
      : null;
  const selectedIds = await actionMediaIds(tx, {
    mediaId,
    input,
    automaticIds: automatic?.mediaIds,
  });
  const renewal = input.action === "select_release" || input.action === "retry";
  await lockCanonicalMedia(tx, [...selectedIds, mediaId]);
  await lockExistingDefaultTargets(tx, [...selectedIds, mediaId]);
  const targets = await lockDefaultScopes(tx, [defaultScope(mediaId)], {
    createMissing: true,
  });
  if (renewal && targets.some(({ target }) => target.lineage !== "resolved"))
    throw new MediaError(
      "lineage_unresolved",
      "Canonical media ancestry needs reconciliation",
      409,
    );
  const primary = targets.find(({ target }) => target.mediaId === mediaId);
  if (primary === undefined)
    throw new Error("Action primary target is missing");
  await lockEffectiveRequests(tx, selectedIds);
  const authority = renewal
    ? { automationEpoch: await commandAutomationEpoch(tx) }
    : {};
  const currentActor = renewal
    ? await authorizeRenewal(tx, actor, {
        mediaId,
        action: input.action,
        ...settings,
      })
    : actor;
  const identityDecision =
    input.action === "select_release" &&
    input.identityConfirmation !== undefined
      ? await confirmIdentity(tx, currentActor, {
          mediaId,
          releaseId: input.releaseId,
          confirmation: input.identityConfirmation,
          ...settings,
        })
      : null;
  if (automatic !== null) {
    for (const id of selectedIds)
      await authorizeRenewal(tx, currentActor, {
        mediaId: id,
        action: "select_release",
        ...settings,
      });
    await tx.$queryRaw`SELECT id FROM "ReleaseCandidate" WHERE id = ${automatic.id} FOR SHARE`;
    const current = await tx.releaseCandidate.findUniqueOrThrow({
      where: { id: automatic.id },
    });
    if (identityHash(current.mediaIds) !== identityHash(automatic.mediaIds))
      throw new MediaError(
        "identity_coverage_changed",
        "Release coverage changed",
        409,
      );
    await assertAutomaticIdentity(tx, current);
  }
  return {
    authority,
    currentActor,
    identityDecision,
    targetExisted: primary.existed,
  };
}
import { removalConfirmation } from "#infrastructure/removal-confirmation.ts";

async function actionMediaIds(
  tx: Prisma.TransactionClient,
  options: {
    mediaId: string;
    input: MediaAction;
    automaticIds: string[] | undefined;
  },
): Promise<string[]> {
  const { mediaId, input, automaticIds } = options;
  if (input.action === "select_release")
    return input.identityConfirmation?.mediaIds ?? automaticIds ?? [mediaId];
  if (input.action === "remove") {
    const confirmation = await removalConfirmation(tx, mediaId);
    return confirmation.media.map((item) => item.id);
  }
  return [mediaId];
}
