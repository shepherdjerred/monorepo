import type { Board } from "#generated/prisma/client.ts";
import type {
  ArtifactSummary,
  BoardSummary,
  VersionSummary,
} from "#shared/procedures.ts";
import { ViewportSchema, type Viewport } from "#shared/contract.ts";
import type { Database } from "#infrastructure/database.ts";
import type { Deps } from "./types.ts";

const DAY_MS = 86_400_000;

export const iso = (date: Date): string => date.toISOString();

export type BoardStats = { artifactCount: number; totalBytes: number };

type StatsRow = { boardId: string; count: number; bytes: bigint };

/** Artifact counts and live bytes (non-purged versions) per board. */
export async function boardStats(
  db: Database,
  boardIds: string[],
): Promise<Map<string, BoardStats>> {
  const stats = new Map<string, BoardStats>();
  if (boardIds.length === 0) return stats;
  const rows = await db.$queryRaw<StatsRow[]>`
    SELECT a."boardId" AS "boardId",
           COUNT(DISTINCT a."id")::int AS "count",
           COALESCE(SUM(v."totalBytes") FILTER (WHERE v."purgedAt" IS NULL), 0)::bigint AS "bytes"
    FROM "Artifact" a
    LEFT JOIN "Version" v ON v."artifactId" = a."id"
    WHERE a."boardId" = ANY(${boardIds}::text[]) AND a."deletedAt" IS NULL
    GROUP BY a."boardId"`;
  for (const row of rows)
    stats.set(row.boardId, {
      artifactCount: row.count,
      totalBytes: Number(row.bytes),
    });
  return stats;
}

/** When the cleanup will purge the board, or null when it never will. */
export async function boardExpiry(
  deps: Pick<Deps, "settings">,
  board: Pick<Board, "keep" | "expiredAt" | "archivedAt" | "lastActivityAt">,
): Promise<Date | null> {
  if (board.keep || board.expiredAt !== null) return null;
  const [idleDays, graceDays] = await Promise.all([
    deps.settings.value("boardIdleDays"),
    deps.settings.value("archiveGraceDays"),
  ]);
  const idle = board.lastActivityAt.getTime() + idleDays * DAY_MS;
  const archived =
    board.archivedAt === null
      ? Number.POSITIVE_INFINITY
      : board.archivedAt.getTime() + graceDays * DAY_MS;
  return new Date(Math.min(idle, archived));
}

export async function presentBoard(
  deps: Pick<Deps, "settings">,
  board: Board,
  stats: BoardStats | undefined,
): Promise<BoardSummary> {
  const expiresAt = await boardExpiry(deps, board);
  return {
    id: board.id,
    slug: board.slug,
    title: board.title,
    revision: board.revision,
    keep: board.keep,
    createdAt: iso(board.createdAt),
    lastActivityAt: iso(board.lastActivityAt),
    archivedAt: board.archivedAt === null ? null : iso(board.archivedAt),
    expiredAt: board.expiredAt === null ? null : iso(board.expiredAt),
    expiresAt: expiresAt === null ? null : iso(expiresAt),
    artifactCount: stats?.artifactCount ?? 0,
    totalBytes: stats?.totalBytes ?? 0,
  };
}

type VersionRow = {
  id: string;
  artifactId: string;
  number: number;
  entryPath: string;
  totalBytes: bigint;
  note: string;
  viewport: unknown;
  createdAt: Date;
  purgedAt: Date | null;
  publisher: { key: string; kind: "human" | "agent" | "runner"; name: string };
  _count: { files: number };
};

export const VERSION_INCLUDE = {
  publisher: true,
  _count: { select: { files: true } },
} as const;

export function presentVersion(version: VersionRow): VersionSummary {
  const viewport: Viewport | null =
    version.viewport === null ? null : ViewportSchema.parse(version.viewport);
  return {
    id: version.id,
    artifactId: version.artifactId,
    number: version.number,
    entryPath: version.entryPath,
    totalBytes: Number(version.totalBytes),
    fileCount: version._count.files,
    note: version.note,
    viewport,
    createdAt: iso(version.createdAt),
    publisher: {
      key: version.publisher.key,
      kind: version.publisher.kind,
      name: version.publisher.name,
    },
    purged: version.purgedAt !== null,
  };
}

type ArtifactRow = {
  id: string;
  boardId: string;
  title: string;
  kind: ArtifactSummary["kind"];
  ownerKey: string;
  createdAt: Date;
  board: { slug: string; title: string };
  currentVersion: VersionRow | null;
  _count: { versions: number };
};

export const ARTIFACT_INCLUDE = {
  board: { select: { slug: true, title: true } },
  currentVersion: { include: VERSION_INCLUDE },
  _count: { select: { versions: true } },
} as const;

export function presentArtifact(
  artifact: ArtifactRow,
  openThreads: number,
): ArtifactSummary {
  return {
    id: artifact.id,
    boardId: artifact.boardId,
    boardSlug: artifact.board.slug,
    boardTitle: artifact.board.title,
    title: artifact.title,
    kind: artifact.kind,
    ownerKey: artifact.ownerKey,
    createdAt: iso(artifact.createdAt),
    versionCount: artifact._count.versions,
    openThreadCount: openThreads,
    currentVersion:
      artifact.currentVersion === null
        ? null
        : presentVersion(artifact.currentVersion),
  };
}

/** Open thread counts per artifact id. */
export async function openThreadCounts(
  db: Database,
  artifactIds: string[],
): Promise<Map<string, number>> {
  const rows = await db.thread.groupBy({
    by: ["artifactId"],
    where: { artifactId: { in: artifactIds }, state: "open" },
    _count: true,
  });
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row.artifactId !== null) counts.set(row.artifactId, row._count);
  return counts;
}

export function contentUrl(origin: string, token: string): string {
  return `${origin}/_t/${token}/`;
}
