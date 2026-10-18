import type { Prisma } from "#generated/prisma/client.ts";
import { defaultIntent, assertDefaultEdition } from "#shared/editions/scope.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PlexIdentitySchema } from "#automation/watch.ts";

export const mediaInclude = {
  intents: { where: { edition: "default" } },
  requests: {
    where: {
      OR: [
        effectiveRequestWhere,
        {
          edition: { not: "default" },
          media: { kind: "movie" },
          active: true,
          excluded: false,
          direct: true,
        },
      ],
    },
    include: { user: { include: { notificationPreference: true } } },
  },
  holds: { where: { edition: "default" } },
  watchStates: { where: { edition: "default" } },
  assets: {
    where: { current: true, edition: "default" },
    include: { asset: true },
  },
} satisfies Prisma.MediaItemInclude;

export type Media = Prisma.MediaItemGetPayload<{
  include: typeof mediaInclude;
}>;

export function lineageResolved(item: Media): boolean {
  const root = defaultIntent(item.intents)?.editionRootId;
  return (
    root != null &&
    item.assets.every(({ asset }) => asset.editionRootId === root)
  );
}

export async function coveredMedia(
  context: MediaAutomationContext,
  mediaId: string,
): Promise<string[]> {
  const assets = await context.db.assetCoverage.findMany({
    where: { mediaId, current: true, edition: "default" },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
  for (const { asset } of assets) {
    assertDefaultEdition(asset.edition);
    for (const coverage of asset.coverage)
      assertDefaultEdition(coverage.edition);
  }
  return [
    ...new Set([
      mediaId,
      ...assets.flatMap((coverage) =>
        coverage.asset.coverage.map((item) => item.mediaId),
      ),
    ]),
  ].sort();
}

export async function currentPlayback(
  context: MediaAutomationContext,
  items: Media[],
): Promise<boolean> {
  const keys = new Set(
    items.map(
      (item) => PlexIdentitySchema.parse(item.externalIds).plexRatingKey,
    ),
  );
  const paths = new Set(
    items.flatMap((item) => item.assets.map((coverage) => coverage.asset.path)),
  );
  const sessions = await context.plex.activeSessions();
  return sessions.some(
    (session) =>
      keys.has(session.ratingKey) ||
      session.Media?.some((media) =>
        media.Part.some((part) => paths.has(part.file)),
      ) === true,
  );
}
