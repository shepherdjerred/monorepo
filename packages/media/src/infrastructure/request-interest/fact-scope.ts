import type {
  MediaItem,
  MediaRequest,
  PlexIdentityMapping,
  Prisma,
} from "#generated/prisma/client.ts";
import { REQUESTER_ACCESS_MAX_AGE_MS } from "#infrastructure/requester-authorization.ts";
import { INTEREST_POLICY } from "#domain/household/interests.ts";

export function mappingCurrent(
  mapping: PlexIdentityMapping,
  kind: string,
  now: Date,
) {
  return (
    mapping.verifiedAt !== null &&
    !mapping.plexRestricted &&
    mapping.verifiedAt <= now &&
    now.getTime() - mapping.verifiedAt.getTime() <=
      REQUESTER_ACCESS_MAX_AGE_MS &&
    mapping.permittedMediaKinds.includes(kind === "movie" ? "movie" : "series")
  );
}
export function catalogCurrent(
  kind: string,
  series: MediaItem | null,
  request: MediaRequest,
  now: Date,
) {
  return (
    (kind !== "series" && kind !== "season") ||
    (request.coverageCompletedAt !== null &&
      series?.catalogCompletedAt != null &&
      series.catalogState === "ready" &&
      series.catalogCompletedAt <= now &&
      now.getTime() - series.catalogCompletedAt.getTime() <=
        INTEREST_POLICY.metadataFreshMs)
  );
}
export function terminalStatus(
  status: string | null,
): "ended" | "cancelled" | "continuing" | "unknown" {
  return status === "ended" || status === "cancelled" || status === "continuing"
    ? status
    : "unknown";
}
export function requestLeaves(
  tx: Prisma.TransactionClient,
  root: MediaItem,
  request: MediaRequest,
) {
  const container = root.kind === "series" || root.kind === "season";
  return tx.mediaItem.findMany({
    where: container
      ? {
          kind: "episode",
          // A user's explicit leaf exclusion masks inherited requests too.
          // Missing coverage rows are deliberately not a filter: known missing
          // or unaired episodes must still prevent a false complete result.
          requests: {
            none: {
              userId: request.userId,
              edition: request.edition,
              excluded: true,
            },
          },
          ...(root.kind === "series"
            ? { OR: [{ parentId: root.id }, { parent: { parentId: root.id } }] }
            : { parentId: root.id }),
          ...(request.includeSpecials ? {} : { NOT: { seasonNumber: 0 } }),
          ...(!request.includeFutureEpisodes &&
          request.coverageCompletedAt !== null
            ? { createdAt: { lte: request.coverageCompletedAt } }
            : {}),
        }
      : { id: root.id },
    include: {
      assets: {
        where: { current: true, edition: request.edition },
        include: { asset: { include: { subtitles: true } } },
      },
    },
    orderBy: { id: "asc" },
    take: 1001,
  });
}
