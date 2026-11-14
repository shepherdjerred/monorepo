import { Prisma, type MediaRequest } from "#generated/prisma/client.ts";

type FollowingInterest = Pick<
  MediaRequest,
  "active" | "excluded" | "direct" | "interestState"
>;

/** Caller supplies its already locked, exact edition/media/source scope.
 * Personal direct release does not withdraw another current container interest. */
export function hasFollowingRequestInterest(
  request: FollowingInterest & {
    coverageSources: readonly {
      active: boolean;
      rootRequest: FollowingInterest;
    }[];
  },
): boolean {
  return (
    request.active &&
    !request.excluded &&
    ((request.direct && request.interestState === "following") ||
      request.coverageSources.some(
        (source) =>
          source.active &&
          source.rootRequest.active &&
          !source.rootRequest.excluded &&
          source.rootRequest.direct &&
          source.rootRequest.interestState === "following",
      ))
  );
}

/** Root cancellation removes authority immediately, before paginated cleanup. */
export const effectiveRequestWhere = {
  edition: "default",
  active: true,
  excluded: false,
  OR: [
    { direct: true, interestState: "following" },
    {
      coverageSources: {
        some: {
          edition: "default",
          active: true,
          rootRequest: {
            edition: "default",
            active: true,
            excluded: false,
            direct: true,
            interestState: "following",
          },
        },
      },
    },
  ],
} satisfies Prisma.MediaRequestWhereInput;

/** Playback/removal explanations retain released interests and their expanded
 * coverage. This is observation authority only, never acquisition authority. */
export const retentionRequestWhere = {
  edition: "default",
  excluded: false,
  OR: [
    { direct: true, active: true },
    {
      coverageSources: {
        some: {
          edition: "default",
          rootRequest: {
            edition: "default",
            active: true,
            excluded: false,
            direct: true,
          },
        },
      },
    },
  ],
} satisfies Prisma.MediaRequestWhereInput;

/** Acquire after sorted leaf MediaItem locks; never acquire parent media here. */
export async function lockEffectiveRequests(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  if (mediaIds.length === 0) return;
  await tx.$queryRaw(Prisma.sql`
    SELECT r.id FROM "MediaRequest" r WHERE r.edition = 'default' AND (r."mediaId" IN (${Prisma.join(mediaIds)})
    OR r.id IN (SELECT c."rootRequestId" FROM "RequestCoverage" c WHERE c.edition = 'default' AND c."mediaId" IN (${Prisma.join(mediaIds)})))
    ORDER BY r.id FOR SHARE
  `);
}
