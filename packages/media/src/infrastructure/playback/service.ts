import {
  historicalBindings,
  importRow,
  requireCurrentPlaybackOwner,
  handoffReplay,
  assertHandoffEvidence,
  historicalManifest,
  validateFinalSnapshot,
} from "./imports.ts";
import type { Prisma, PlaybackSession } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { PlaybackHistoryApplication } from "#application/playback-ports.ts";
import { MINIMUM_PLAY_MS } from "#domain/household/playback.ts";
import {
  PlaybackSessionViewSchema,
  type ImportPlaybackHistory,
  type PlaybackQuery,
  type SealPlaybackHandoff,
  type PlaybackHandoffEvidence,
} from "#shared/household/playback.ts";

function scope(
  actor: MediaActor,
  query: PlaybackQuery,
  completed = true,
): Prisma.PlaybackSessionWhereInput {
  if (
    actor.role !== "owner" &&
    query.userId !== undefined &&
    query.userId !== actor.id
  )
    throw new MediaError(
      "forbidden",
      "You can only view your own playback",
      403,
    );
  const from = query.from === undefined ? undefined : new Date(query.from);
  const to = query.to === undefined ? undefined : new Date(query.to);
  if (from !== undefined && to !== undefined && from >= to)
    throw new MediaError("invalid_range", "Start must be before end");
  return {
    ...(actor.role === "owner"
      ? query.userId === undefined
        ? {}
        : { userId: query.userId }
      : { userId: actor.id }),
    ...(completed
      ? { state: "stopped", watchedMs: { gte: MINIMUM_PLAY_MS } }
      : {}),
    ...dateScope(from, to),
    ...(query.search === undefined || query.search === ""
      ? {}
      : {
          OR: [
            { title: { contains: query.search, mode: "insensitive" } },
            { seriesTitle: { contains: query.search, mode: "insensitive" } },
          ],
        }),
  };
}

function dateScope(
  from: Date | undefined,
  to: Date | undefined,
): Prisma.PlaybackSessionWhereInput {
  if (from === undefined && to === undefined) return {};
  return {
    startedAt: {
      ...(from === undefined ? {} : { gte: from }),
      ...(to === undefined ? {} : { lt: to }),
    },
  };
}
function rank(
  label: string,
  row: { _count: number; _sum: { watchedMs: number | null } },
) {
  return { label, plays: row._count, watchedMs: row._sum.watchedMs ?? 0 };
}

function view(row: PlaybackSession, names: ReadonlyMap<string, string>) {
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
  });
}

export class PrismaPlaybackHistory implements PlaybackHistoryApplication {
  constructor(
    private readonly database: Database,
    private readonly serverMachineId: string,
    private readonly clock = () => new Date(),
    private readonly handoffReady?: (
      actor: MediaActor,
    ) => Promise<PlaybackHandoffEvidence>,
  ) {}

  async people(actor: MediaActor) {
    actor = await this.currentActor(actor);
    scope(actor, { limit: 100 }, false);
    return this.database.mediaUser.findMany({
      where: actor.role === "owner" ? {} : { id: actor.id },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: 100,
    });
  }

  private async currentActor(actor: MediaActor): Promise<MediaActor> {
    const current = await this.database.mediaUser.findUnique({
      where: { id: actor.id },
    });
    if (current?.plexAccountId !== actor.plexAccountId)
      throw new MediaError(
        "unauthorized",
        "This account is no longer available",
        401,
      );
    return {
      ...actor,
      role:
        current.role === "owner" && !current.restricted ? "owner" : "member",
      restricted: current.restricted,
      version: current.version,
    };
  }

  private async names(rows: readonly { userId: string | null }[]) {
    const ids = [
      ...new Set(
        rows.flatMap((row) => (row.userId === null ? [] : [row.userId])),
      ),
    ];
    const users = await this.database.mediaUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((user) => [user.id, user.displayName]));
  }

  async history(actor: MediaActor, query: PlaybackQuery) {
    actor = await this.currentActor(actor);
    const where = {
      serverMachineId: this.serverMachineId,
      ...scope(actor, query),
    };
    // Validate a cursor within the same privacy scope; a foreign cursor is never a probe.
    if (
      query.cursor !== undefined &&
      (await this.database.playbackSession.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      })) === null
    )
      throw new MediaError(
        "invalid_cursor",
        "This history page has expired",
        400,
      );
    const rows = await this.database.playbackSession.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor === undefined
        ? {}
        : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const names = await this.names(rows);
    return {
      items: rows.slice(0, query.limit).map((row) => view(row, names)),
      nextCursor:
        rows.length > query.limit
          ? (rows.at(query.limit - 1)?.id ?? null)
          : null,
    };
  }

  async nowPlaying(actor: MediaActor) {
    actor = await this.currentActor(actor);
    const collector = await this.database.playbackCollector.findUnique({
      where: { serverMachineId: this.serverMachineId },
    });
    const stale =
      collector?.observedAt === null ||
      collector?.observedAt === undefined ||
      this.clock().getTime() - collector.observedAt.getTime() > 120_000;
    const rows = stale
      ? []
      : await this.database.playbackSession.findMany({
          where: {
            serverMachineId: this.serverMachineId,
            ...scope(actor, { limit: 100 }, false),
            state: { not: "stopped" },
          },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: 100,
        });
    // Scope validation also runs on a stale/empty observation.
    scope(actor, { limit: 100 }, false);
    const names = await this.names(rows);
    return {
      observedAt: collector?.observedAt?.toISOString() ?? null,
      stale,
      items: rows.map((row) => view(row, names)),
    };
  }

  async statistics(actor: MediaActor, query: PlaybackQuery) {
    actor = await this.currentActor(actor);
    const where = {
      serverMachineId: this.serverMachineId,
      ...scope(actor, query),
    };
    const [total, titles, users, platforms, decisions, completed] =
      await Promise.all([
        this.database.playbackSession.aggregate({
          where,
          _count: true,
          _sum: { watchedMs: true },
        }),
        this.database.playbackSession.groupBy({
          by: ["title"],
          where,
          _count: true,
          _sum: { watchedMs: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        }),
        this.database.playbackSession.groupBy({
          by: ["userId"],
          where,
          _count: true,
          _sum: { watchedMs: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        }),
        this.database.playbackSession.groupBy({
          by: ["platform"],
          where,
          _count: true,
          _sum: { watchedMs: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        }),
        this.database.playbackSession.groupBy({
          by: ["decision"],
          where,
          _count: true,
        }),
        this.database.playbackSession.count({
          where: { ...where, reportingCompleted: true },
        }),
      ]);
    const names = await this.names(users);
    return {
      plays: total._count,
      watchedMs: total._sum.watchedMs ?? 0,
      completedPlays: completed,
      topTitles: titles.map((row) => rank(row.title, row)),
      topUsers: users.map((row) =>
        rank(
          row.userId === null
            ? "Unmapped account"
            : (names.get(row.userId) ?? "Former account"),
          row,
        ),
      ),
      topPlatforms: platforms.map((row) => rank(row.platform, row)),
      decisions: decisions.map((row) => ({
        decision: PlaybackSessionViewSchema.shape.decision.parse(row.decision),
        plays: row._count,
      })),
      minimumPlayMs: 120_000 as const,
      completionPercent: 85 as const,
    };
  }

  async importHistory(actor: MediaActor, input: ImportPlaybackHistory) {
    actor = await this.currentActor(actor);
    requireOwner(actor);
    if (input.serverMachineId !== this.serverMachineId)
      throw new MediaError(
        "wrong_server",
        "History belongs to another Plex server",
        409,
      );
    const through = new Date(input.through);
    if (
      through > this.clock() ||
      input.rows.some((row) => row.stopped * 1000 > through.getTime())
    )
      throw new MediaError(
        "invalid_boundary",
        "Historical sessions must finish before the import boundary",
        422,
      );
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-playback:${this.serverMachineId}`}))`;
        await requireCurrentPlaybackOwner(tx, actor);
        const collector = await tx.playbackCollector.upsert({
          where: { serverMachineId: this.serverMachineId },
          create: { serverMachineId: this.serverMachineId },
          update: {},
        });
        const collectionStart = collector.collectionStartedAt;
        if (
          collectionStart !== null &&
          (through > collectionStart ||
            input.rows.some(
              (row) => row.stopped * 1000 >= collectionStart.getTime(),
            ))
        )
          throw new MediaError(
            "collector_overlap",
            "This history overlaps live collection; use the recorded import boundary",
            409,
          );
        if (
          collector.importSourceInstanceId !== null &&
          collector.importSourceInstanceId !== input.sourceInstanceId
        )
          throw new MediaError(
            "import_source_changed",
            "History source identity changed",
            409,
          );
        const users = await historicalBindings(tx, input.userBindings);
        let imported = 0;
        let unchanged = 0;
        for (const row of input.rows) {
          if (
            await importRow(
              tx,
              {
                serverMachineId: this.serverMachineId,
                sourceInstanceId: input.sourceInstanceId,
                users,
                sealed: collector.collectionStartedAt !== null,
              },
              row,
            )
          )
            imported++;
          else unchanged++;
        }
        await tx.playbackCollector.update({
          where: { serverMachineId: this.serverMachineId },
          data: {
            importSourceInstanceId: input.sourceInstanceId,
            importedThrough:
              collector.importedThrough !== null &&
              collector.importedThrough > through
                ? collector.importedThrough
                : through,
            version: { increment: 1 },
          },
        });
        return { imported, unchanged };
      },
      { timeout: 30_000 },
    );
  }

  async sealHandoff(actor: MediaActor, input: SealPlaybackHandoff) {
    actor = await this.currentActor(actor);
    requireOwner(actor);
    const previous = await this.database.playbackCollector.findUnique({
      where: { serverMachineId: this.serverMachineId },
    });
    if (
      previous?.collectionStartedAt !== null &&
      previous?.collectionStartedAt !== undefined &&
      previous.importSourceInstanceId === input.sourceInstanceId &&
      handoffReplay(previous, input)
    )
      return {
        version: previous.version,
        collectionStartedAt: previous.collectionStartedAt.toISOString(),
      };
    if (this.handoffReady === undefined)
      throw new MediaError(
        "handoff_unavailable",
        "Playback handoff proof is not configured",
        503,
      );
    const evidence = await this.handoffReady(actor);
    const through = new Date(input.through);
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-playback:${this.serverMachineId}`}))`;
      await requireCurrentPlaybackOwner(tx, actor);
      const checkpoint = await tx.playbackCollector.findUnique({
        where: { serverMachineId: this.serverMachineId },
      });
      const now = this.clock();
      if (
        checkpoint?.importSourceInstanceId !== input.sourceInstanceId ||
        checkpoint.importedThrough?.getTime() !== through.getTime()
      )
        throw new MediaError(
          "snapshot_incomplete",
          "Import the complete final snapshot before activating playback collection",
          409,
        );
      if (checkpoint.collectionStartedAt !== null) {
        // An identical seal retry is read-only; it cannot reset the boundary.
        if (handoffReplay(checkpoint, input))
          return {
            version: checkpoint.version,
            collectionStartedAt: checkpoint.collectionStartedAt.toISOString(),
          };
        throw new MediaError(
          "handoff_already_sealed",
          "Playback history already has a different handoff",
          409,
        );
      }
      if (checkpoint.version !== input.expectedVersion)
        throw new MediaError(
          "stale_version",
          "The history import changed; review the latest snapshot",
          409,
        );
      const quiescedAt = assertHandoffEvidence(input, evidence, now);
      await validateFinalSnapshot(tx, input, this.serverMachineId);
      const updated = await tx.playbackCollector.update({
        where: { serverMachineId: this.serverMachineId },
        data: {
          collectionStartedAt: now,
          version: { increment: 1 },
          handoffEvidence: {
            snapshotDigest: input.snapshotDigest,
            expectedSessions: input.expectedSessions,
            through: through.toISOString(),
            quiescenceCapturedAt: quiescedAt.toISOString(),
            inventoryDigest: evidence.inventoryDigest,
            capturedAt: evidence.capturedAt.toISOString(),
            expiresAt: evidence.expiresAt.toISOString(),
          },
        },
      });
      return {
        version: updated.version,
        collectionStartedAt: now.toISOString(),
      };
    });
  }

  async handoffStatus(actor: MediaActor) {
    requireOwner(await this.currentActor(actor));
    const checkpoint = await this.database.playbackCollector.findUnique({
      where: { serverMachineId: this.serverMachineId },
    });
    const manifest =
      checkpoint?.importSourceInstanceId === null ||
      checkpoint?.importSourceInstanceId === undefined
        ? { sessions: 0, snapshotDigest: null }
        : await historicalManifest(
            this.database,
            checkpoint.importSourceInstanceId,
            this.serverMachineId,
          );
    return {
      version: checkpoint?.version ?? 0,
      sourceInstanceId: checkpoint?.importSourceInstanceId ?? null,
      importedThrough: checkpoint?.importedThrough?.toISOString() ?? null,
      collectionStartedAt:
        checkpoint?.collectionStartedAt?.toISOString() ?? null,
      ...manifest,
    };
  }
}
