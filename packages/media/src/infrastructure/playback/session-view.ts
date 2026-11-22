import type { PlaybackSession, Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import {
  assessVisibilityAccess,
  type VisibilitySections,
  type VisibleMedia,
} from "#infrastructure/visibility/access.ts";
import {
  mediaReference,
  rootMedia,
} from "#infrastructure/library/views/artwork.ts";
import type { MediaReference } from "#shared/household/media-reference.ts";
import { PlaybackSessionViewSchema } from "#shared/household/playback.ts";

/** The Plex server whose plays are read, and the sections its titles default to. */
export type PlaybackServer = {
  serverMachineId: string;
  sections?: Partial<VisibilitySections> | undefined;
};

const linkFields = {
  id: true,
  kind: true,
  title: true,
  externalIds: true,
  parentId: true,
  posterPath: true,
  backdropPath: true,
} as const;
const linkSelect = {
  ...linkFields,
  parent: { select: { ...linkFields, parent: { select: linkFields } } },
} as const satisfies Prisma.MediaItemSelect;
export type PlaybackLinkTitle = Prisma.MediaItemGetPayload<{
  select: typeof linkSelect;
}>;

/**
 * The title behind each Plex rating key. A key is left out, so its plays carry
 * no title, when no claim names it, when claims in different sections name
 * different titles, or when the reader could not open the title page:
 * `visible` is the rule `GET /media/:id` applies, checked here on the played
 * item and on its movie or series, since a play links to either.
 */
export function playbackMediaByRatingKey(
  claims: readonly { ratingKey: string; mediaId: string }[],
  titles: readonly PlaybackLinkTitle[],
  visible: (media: VisibleMedia) => boolean,
): Map<string, MediaReference> {
  const claimed = new Map<string, Set<string>>();
  for (const claim of claims) {
    const mediaIds = claimed.get(claim.ratingKey) ?? new Set<string>();
    claimed.set(claim.ratingKey, mediaIds.add(claim.mediaId));
  }
  const byId = new Map(titles.map((title) => [title.id, title]));
  const resolved = new Map<string, MediaReference>();
  for (const [ratingKey, mediaIds] of claimed) {
    const [mediaId] = mediaIds;
    if (mediaId === undefined || mediaIds.size !== 1) continue;
    const title = byId.get(mediaId);
    if (title === undefined)
      throw new Error("A Plex item claim names a title that does not exist");
    if (!visible(title) || !visible(rootMedia(title))) continue;
    resolved.set(ratingKey, mediaReference(title));
  }
  return resolved;
}

/**
 * A play stores only the rating key Plex reported, so its title is resolved
 * when it is read, through the item claims Media holds on that server today:
 * two lookups for the whole page, none per play.
 *
 * Reading plays needs no library access, so a reader whose Plex access is
 * missing or stale still gets the plays, with no titles until that access is
 * current again.
 */
export function readPlaybackMedia(
  db: Database,
  actor: MediaActor,
  server: PlaybackServer,
  sessions: readonly Pick<PlaybackSession, "ratingKey">[],
): Promise<ReadonlyMap<string, MediaReference>> {
  const ratingKeys = [...new Set(sessions.map((row) => row.ratingKey))];
  if (ratingKeys.length === 0) return Promise.resolve(new Map());
  return repeatableRead(db, async (tx) => {
    const { reader } = await assessVisibilityAccess(tx, actor, server);
    if (reader === null) return new Map();
    const claims = await tx.plexItemClaim.findMany({
      where: {
        serverMachineId: server.serverMachineId,
        ratingKey: { in: ratingKeys },
      },
      select: { ratingKey: true, mediaId: true },
    });
    const titles = await tx.mediaItem.findMany({
      where: { id: { in: [...new Set(claims.map((row) => row.mediaId))] } },
      select: linkSelect,
    });
    return playbackMediaByRatingKey(claims, titles, reader.visible);
  });
}

export function playbackSessionView(
  row: PlaybackSession,
  names: ReadonlyMap<string, string>,
  media: ReadonlyMap<string, MediaReference>,
) {
  return PlaybackSessionViewSchema.parse({
    id: row.id,
    title: row.title,
    seriesTitle: row.seriesTitle,
    mediaType: row.mediaType,
    userId: row.userId,
    userName: row.userId === null ? null : (names.get(row.userId) ?? null),
    platform: row.platform,
    decision: row.decision,
    startedAt: row.startedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    durationMs: row.durationMs,
    watchedMs: row.watchedMs,
    progressMs: row.maxProgressMs,
    completed: row.reportingCompleted,
    state: row.state,
    source: row.source,
    media: media.get(row.ratingKey) ?? null,
  });
}
