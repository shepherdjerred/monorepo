import { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";

/** The hierarchy has movie or series/season/episode depth. No parent MediaItem
 * locks are acquired after a leaf lock; policy targets and claims use SHARE. */
export async function readInterestAncestry(
  tx: Prisma.TransactionClient,
  mediaId: string,
) {
  const chain: { id: string; parentId: string | null; kind: string }[] = [];
  let current: string | null = mediaId;
  while (current !== null) {
    if (chain.length === 3 || chain.some((item) => item.id === current))
      throw new MediaError(
        "lineage_unresolved",
        "Media ancestry requires reconciliation",
        409,
      );
    const item: { id: string; parentId: string | null; kind: string } =
      await tx.mediaItem.findUniqueOrThrow({
        where: { id: current },
        select: { id: true, parentId: true, kind: true },
      });
    chain.push(item);
    current = item.parentId;
  }
  return chain;
}

export async function householdRetentionState(
  tx: Prisma.TransactionClient,
  mediaId: string,
  edition = "default",
) {
  const ancestry = await readInterestAncestry(tx, mediaId);
  const mediaIds = ancestry.map((item) => item.id).sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "MediaIntent" WHERE "mediaId" IN (${Prisma.join(mediaIds)}) AND edition=${edition} ORDER BY "mediaId" FOR SHARE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaRequest" WHERE "mediaId" IN (${Prisma.join(mediaIds)}) AND edition=${edition} ORDER BY id FOR SHARE`,
  );
  const targets = await tx.mediaIntent.findMany({
    where: { mediaId: { in: mediaIds }, edition },
  });
  const explicit = ancestry
    .map((item) => targets.find((target) => target.mediaId === item.id))
    .find((target) => target?.libraryPolicyExplicit === true);
  const libraryKeep =
    targets.some(
      (target) => target.libraryPolicyExplicit && target.libraryKeep,
    ) ||
    (explicit === undefined && targets.some((target) => target.libraryKeep));
  const roots = await tx.mediaRequest.findMany({
    where: {
      mediaId: { in: mediaIds },
      edition,
      direct: true,
      active: true,
      excluded: false,
    },
    include: { user: { include: { notificationPreference: true } } },
  });
  const holds = await tx.retentionHold.findMany({
    where: { mediaId: { in: mediaIds }, edition },
  });
  const policyOwner =
    explicit?.libraryPolicyActorId == null
      ? null
      : await tx.mediaUser.findUnique({
          where: { id: explicit.libraryPolicyActorId },
          include: { notificationPreference: true },
        });
  const ownerConsent =
    explicit?.libraryKeep === false &&
    policyOwner?.role === "owner" &&
    !policyOwner.restricted;
  const reason = householdProtectionReason({
    libraryKeep,
    holds,
    roots,
    ownerConsent,
  });
  const recipients = [
    ...new Map(
      roots.map((request) => [
        request.userId,
        { userId: request.userId, user: request.user },
      ]),
    ).values(),
  ];
  if (ownerConsent && recipients.length === 0)
    recipients.push({ userId: policyOwner.id, user: policyOwner });
  return { reason, roots, recipients, libraryKeep, ancestry };
}

function householdProtectionReason(input: {
  libraryKeep: boolean;
  holds: { isPin: boolean; until: Date | null }[];
  roots: { keepingPolicy: string; interestState: string }[];
  ownerConsent: boolean;
}): string | null {
  if (input.libraryKeep) return "library_kept_indefinitely";
  if (
    input.holds.some(
      (hold) => hold.isPin || hold.until === null || hold.until > new Date(),
    )
  )
    return "ancestor_keep_hold";
  if (input.roots.some((request) => request.keepingPolicy === "keep"))
    return "request_kept_indefinitely";
  if (input.roots.some((request) => request.interestState === "following"))
    return "requester_still_following";
  return !input.ownerConsent && input.roots.length === 0
    ? "owner_only_or_unclaimed"
    : null;
}
