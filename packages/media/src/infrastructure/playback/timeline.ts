import type {
  PlaybackSession,
  PlexHistoricalView,
  Prisma,
} from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { PlaybackTimelineQuery } from "#shared/household/playback.ts";
import { playbackScope } from "./scope.ts";

type Cursor = NonNullable<PlaybackTimelineQuery["cursor"]>;
type Anchor =
  | { kind: "session"; id: string; at: Date }
  | { kind: "plex_view"; source: string; sourceViewId: bigint; at: Date };

type Row =
  | { kind: "session"; at: Date; value: PlaybackSession }
  | { kind: "plex_view"; at: Date; value: PlexHistoricalView };

function cursorId(row: Row): string {
  return row.kind === "session"
    ? `session:${row.value.id}`
    : `${row.value.source}:${String(row.value.sourceViewId)}`;
}

// The two database sorts agree with this order. Timed sessions come first
// when a Plex marker and a session have the same timestamp.
function descending<T extends string | bigint>(left: T, right: T): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function compare(left: Row, right: Row): number {
  const byTime = right.at.getTime() - left.at.getTime();
  if (byTime !== 0) return byTime;
  if (left.kind === "session")
    return right.kind === "session"
      ? descending(left.value.id, right.value.id)
      : -1;
  return right.kind === "session"
    ? 1
    : descending(left.value.source, right.value.source) ||
        descending(left.value.sourceViewId, right.value.sourceViewId);
}

async function readAnchor(
  db: Prisma.TransactionClient,
  cursor: Cursor,
  sessions: Prisma.PlaybackSessionWhereInput,
  views: Prisma.PlexHistoricalViewWhereInput | null,
): Promise<Anchor> {
  if (cursor.kind === "session") {
    const row = await db.playbackSession.findFirst({
      where: { ...sessions, id: cursor.id },
      select: { id: true, startedAt: true },
    });
    if (row !== null) return { ...cursor, at: row.startedAt };
  } else if (views !== null) {
    const row = await db.plexHistoricalView.findFirst({
      where: {
        ...views,
        source: cursor.source,
        sourceViewId: BigInt(cursor.sourceViewId),
      },
      select: { viewedAt: true, source: true, sourceViewId: true },
    });
    if (row !== null)
      return {
        kind: "plex_view",
        at: row.viewedAt,
        source: row.source,
        sourceViewId: row.sourceViewId,
      };
  }
  throw new MediaError("invalid_cursor", "This history page has expired", 400);
}

function olderSessions(
  anchor: Anchor | null,
): Prisma.PlaybackSessionWhereInput {
  if (anchor === null) return {};
  if (anchor.kind === "plex_view") return { startedAt: { lt: anchor.at } };
  return {
    OR: [
      { startedAt: { lt: anchor.at } },
      { startedAt: anchor.at, id: { lt: anchor.id } },
    ],
  };
}

function olderViews(
  anchor: Anchor | null,
): Prisma.PlexHistoricalViewWhereInput {
  if (anchor === null) return {};
  if (anchor.kind === "session") return { viewedAt: { lte: anchor.at } };
  return {
    OR: [
      { viewedAt: { lt: anchor.at } },
      { viewedAt: anchor.at, source: { lt: anchor.source } },
      {
        viewedAt: anchor.at,
        source: anchor.source,
        sourceViewId: { lt: anchor.sourceViewId },
      },
    ],
  };
}

function verifiedMappings(
  serverMachineId: string,
): Prisma.PlexIdentityMappingWhereInput {
  return {
    serverMachineId,
    serverAccountId: { not: null },
    plexRestricted: false,
    verifiedAt: { not: null },
    user: { restricted: false },
  };
}

async function viewScope(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  serverMachineId: string,
  query: PlaybackTimelineQuery,
): Promise<Prisma.PlexHistoricalViewWhereInput | null> {
  if (query.source === "tautulli") return null;
  const userId = actor.role === "owner" ? query.userId : actor.id;
  const where: Prisma.PlexHistoricalViewWhereInput = { serverMachineId };
  if (userId !== undefined) {
    const identity = await db.plexIdentityMapping.findFirst({
      where: { ...verifiedMappings(serverMachineId), userId },
      select: {
        serverAccountId: true,
        user: { select: { plexAccountId: true } },
      },
    });
    if (identity?.serverAccountId == null) return null;
    where.serverAccountId = identity.serverAccountId;
    where.boundPlexAccountId = identity.user.plexAccountId;
  }
  if (query.from !== undefined || query.to !== undefined)
    where.viewedAt = {
      ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
      ...(query.to === undefined ? {} : { lt: new Date(query.to) }),
    };
  if (query.search !== undefined && query.search !== "")
    where.OR = [
      { title: { contains: query.search, mode: "insensitive" } },
      { seriesTitle: { contains: query.search, mode: "insensitive" } },
    ];
  return where;
}

async function viewNames(
  db: Prisma.TransactionClient,
  serverMachineId: string,
  views: readonly PlexHistoricalView[],
): Promise<
  ReadonlyMap<string | null, { plexAccountId: string; displayName: string }>
> {
  if (views.length === 0) return new Map();
  const mappings = await db.plexIdentityMapping.findMany({
    where: {
      ...verifiedMappings(serverMachineId),
      serverAccountId: { in: views.map((view) => view.serverAccountId) },
    },
    select: {
      serverAccountId: true,
      user: { select: { plexAccountId: true, displayName: true } },
    },
  });
  return new Map(
    mappings.map((mapping) => [mapping.serverAccountId, mapping.user]),
  );
}

export async function readPlaybackTimeline(
  db: Prisma.TransactionClient,
  {
    actor,
    serverMachineId,
    query,
  }: {
    actor: MediaActor;
    serverMachineId: string;
    query: PlaybackTimelineQuery;
  },
) {
  const sessions = { serverMachineId, ...playbackScope(actor, query) };
  const views = await viewScope(db, actor, serverMachineId, query);
  // A cursor proves that its original item is still visible under these filters.
  const anchor =
    query.cursor === undefined
      ? null
      : await readAnchor(db, query.cursor, sessions, views);
  const take = query.limit + 1;
  const [sessionRows, viewRows] = await Promise.all([
    db.playbackSession.findMany({
      where: { AND: [sessions, olderSessions(anchor)] },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take,
    }),
    views === null
      ? []
      : db.plexHistoricalView.findMany({
          where: { AND: [views, olderViews(anchor)] },
          orderBy: [
            { viewedAt: "desc" },
            { source: "desc" },
            { sourceViewId: "desc" },
          ],
          take,
        }),
  ]);
  const rows: Row[] = [
    ...sessionRows.map((row) => ({
      kind: "session" as const,
      at: row.startedAt,
      value: row,
    })),
    ...viewRows.map((row) => ({
      kind: "plex_view" as const,
      at: row.viewedAt,
      value: row,
    })),
  ];
  rows.sort(compare);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const names = await viewNames(
    db,
    serverMachineId,
    page.flatMap((row) => (row.kind === "plex_view" ? [row.value] : [])),
  );
  return {
    page: page.map((row) => {
      if (row.kind === "session") return row;
      const mapping = names.get(row.value.serverAccountId);
      return {
        kind: "plex_view" as const,
        id: cursorId(row),
        source: row.value.source,
        mediaKind: row.value.kind,
        title: row.value.title,
        seriesTitle: row.value.seriesTitle,
        seasonNumber: row.value.seasonNumber,
        episodeNumber: row.value.episodeNumber,
        viewedAt: row.at.toISOString(),
        userName:
          mapping?.plexAccountId === row.value.boundPlexAccountId
            ? mapping.displayName
            : null,
      };
    }),
    nextCursor:
      last !== undefined && rows.length > page.length ? cursorId(last) : null,
  };
}
