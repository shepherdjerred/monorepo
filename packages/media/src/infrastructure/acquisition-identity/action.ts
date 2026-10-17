import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaAction } from "#shared/contract.ts";
import type { MediaCommandSettings } from "#infrastructure/command-base.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import { authorizeRenewal } from "#infrastructure/action-guards.ts";
import { lockAcquisitionMedia } from "./locks.ts";
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
  const selectedIds =
    input.action === "select_release"
      ? (input.identityConfirmation?.mediaIds ??
        automatic?.mediaIds ?? [mediaId])
      : [mediaId];
  const renewal = input.action === "select_release" || input.action === "retry";
  if (renewal) await lockAcquisitionMedia(tx, selectedIds);
  else await lockMedia(tx, [mediaId]);
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
  return { authority, currentActor, identityDecision };
}
