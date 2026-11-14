import type { Database } from "#infrastructure/database.ts";
import type {
  PlexPlaybackClient,
  PlexPlaybackSession,
} from "#integrations/plex-playback.ts";
import {
  MINIMUM_PLAY_MS,
  playbackAdvance,
  playbackCompleted,
} from "#domain/household/playback.ts";
import type { Prisma } from "#generated/prisma/client.ts";

/** Whole-server observation, with a separate owner-scoped Plex token and model. */
export class PrismaPlaybackCollector {
  constructor(
    private readonly database: Database,
    private readonly client: Pick<PlexPlaybackClient, "sessions">,
    private readonly serverMachineId: string,
    private readonly clock = () => new Date(),
  ) {}

  async reconcile(signal?: AbortSignal) {
    const sessions = await this.client.sessions(signal);
    const now = this.clock();
    // A failed or incomplete Plex response never finalizes prior sessions.
    const ids = sessions.map((session) => session.sessionId);
    if (new Set(ids).size !== ids.length)
      throw new Error("Plex returned duplicate playback session identities");
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-playback:${this.serverMachineId}`}))`;
        const checkpoint = await tx.playbackCollector.findUnique({
          where: { serverMachineId: this.serverMachineId },
        });
        if (checkpoint === null) return { observed: 0, completed: 0 };
        if (checkpoint.collectionStartedAt === null)
          return { observed: 0, completed: 0 };
        if (checkpoint.observedAt !== null && checkpoint.observedAt >= now)
          return { observed: sessions.length, completed: 0 };
        const mappings = await tx.plexIdentityMapping.findMany({
          where: {
            serverMachineId: this.serverMachineId,
            verifiedAt: { not: null },
          },
          select: { serverAccountId: true, userId: true },
        });
        const userIds = new Map(
          mappings.flatMap((mapping) =>
            mapping.serverAccountId === null
              ? []
              : [[mapping.serverAccountId, mapping.userId] as const],
          ),
        );
        const active = await tx.playbackSession.findMany({
          where: {
            serverMachineId: this.serverMachineId,
            state: { not: "stopped" },
            source: "plex",
          },
          select: { id: true, lastSeenAt: true },
          take: 1001,
        });
        if (active.length > 1000)
          throw new Error(
            "Active playback reconciliation exceeds its bounded page",
          );
        const observed = new Set<string>();
        for (const session of sessions) {
          observed.add(
            await observeSession(tx, session, {
              serverMachineId: this.serverMachineId,
              userId: userIds.get(session.serverAccountId) ?? null,
              now,
            }),
          );
        }
        let completed = 0;
        for (const row of active) {
          if (!observed.has(row.id)) {
            // The last observed timestamp is the evidence boundary, not the next poll time.
            await tx.playbackSession.update({
              where: { id: row.id },
              data: { state: "stopped", stoppedAt: row.lastSeenAt },
            });
            completed++;
          }
        }
        await tx.playbackCollector.update({
          where: { serverMachineId: this.serverMachineId },
          data: {
            observedAt: now,
            version: { increment: 1 },
          },
        });
        return { observed: sessions.length, completed };
      },
      { timeout: 30_000 },
    );
  }

  /** Native progress only. Callers still prove current account/item association and availability. */
  async lastMeaningfulProgress(
    userId: string,
    ratingKeys: readonly string[],
  ): Promise<Date | null> {
    if (ratingKeys.length === 0) return null;
    const result = await this.database.playbackSession.aggregate({
      where: {
        serverMachineId: this.serverMachineId,
        source: "plex",
        userId,
        ratingKey: { in: [...ratingKeys] },
        meaningfulProgressAt: { not: null },
      },
      _max: { meaningfulProgressAt: true },
    });
    return result._max.meaningfulProgressAt;
  }
}

async function observeSession(
  tx: Prisma.TransactionClient,
  session: PlexPlaybackSession,
  context: { serverMachineId: string; userId: string | null; now: Date },
) {
  const { serverMachineId, userId, now } = context;
  const identity = {
    source: "plex",
    sourceInstanceId: serverMachineId,
    sourceSessionId: session.sessionId,
  };
  const prior = await tx.playbackSessionIdentity.findUnique({
    where: { source_sourceInstanceId_sourceSessionId: identity },
    include: { session: true },
  });
  if (prior === null) {
    const row = await tx.playbackSession.create({
      data: {
        ...snapshot(session),
        serverMachineId,
        userId,
        startedAt: now,
        lastSeenAt: now,
        source: "plex",
        identities: { create: identity },
      },
    });
    return row.id;
  }
  const previous = prior.session;
  if (
    previous.serverAccountId !== session.serverAccountId ||
    previous.ratingKey !== session.ratingKey ||
    previous.playerId !== session.playerId
  )
    throw new Error(
      "Plex reused a playback session identity for different content or account",
    );
  // Late/retried samples cannot resurrect a completed identity.
  if (previous.state === "stopped" || previous.lastSeenAt >= now)
    return previous.id;
  const advance = playbackAdvance({
    previousAt: previous.lastSeenAt,
    observedAt: now,
    previousProgressMs: previous.lastProgressMs,
    progressMs: session.progressMs,
    previousState: previous.state,
    state: session.state,
  });
  await tx.playbackSession.update({
    where: { id: previous.id },
    data: {
      userId,
      state: session.state,
      decision: session.decision,
      lastSeenAt: now,
      lastProgressMs: session.progressMs,
      maxProgressMs: Math.max(previous.maxProgressMs, session.progressMs),
      watchedMs: { increment: advance },
      durationMs: session.durationMs,
      reportingCompleted: playbackCompleted(
        Math.max(previous.maxProgressMs, session.progressMs),
        session.durationMs,
      ),
      ...(advance > 0 && previous.watchedMs + advance >= MINIMUM_PLAY_MS
        ? { meaningfulProgressAt: now }
        : {}),
    },
  });
  return previous.id;
}

function snapshot(session: PlexPlaybackSession) {
  return {
    serverAccountId: session.serverAccountId,
    ratingKey: session.ratingKey,
    title: session.title,
    seriesTitle: session.seriesTitle,
    mediaType: session.mediaType,
    platform: session.platform,
    playerId: session.playerId,
    decision: session.decision,
    durationMs: session.durationMs,
    maxProgressMs: session.progressMs,
    lastProgressMs: session.progressMs,
    reportingCompleted: playbackCompleted(
      session.progressMs,
      session.durationMs,
    ),
    state: session.state,
  };
}
