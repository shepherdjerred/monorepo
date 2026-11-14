import type {
  Prisma,
  PlaybackSession,
  PlaybackCollector,
} from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";
import type {
  ImportPlaybackHistory,
  SealPlaybackHandoff,
  PlaybackHandoffEvidence,
} from "#shared/household/playback.ts";

export async function historicalBindings(
  tx: Prisma.TransactionClient,
  bindings: ImportPlaybackHistory["userBindings"],
) {
  if (
    new Set(bindings.map((binding) => binding.sourceUserId)).size !==
    bindings.length
  )
    throw new MediaError(
      "duplicate_binding",
      "Historical account bindings must be unique",
      422,
    );
  const users = new Map<string, string>();
  for (const binding of bindings) {
    const user = await tx.mediaUser.findUnique({
      where: { id: binding.userId },
      select: { plexAccountId: true },
    });
    if (user?.plexAccountId !== binding.plexAccountId)
      throw new MediaError(
        "identity_changed",
        "Historical account binding no longer matches the reviewed Plex identity",
        409,
      );
    users.set(binding.sourceUserId, binding.userId);
  }
  return users;
}

function assertHistoricalSnapshot(
  existing: PlaybackSession,
  serverMachineId: string,
  row: ImportPlaybackHistory["rows"][number],
) {
  if (
    existing.serverMachineId !== serverMachineId ||
    existing.sourceSnapshotDigest !== snapshotHash(row)
  )
    throw new MediaError(
      "history_changed",
      "A previously imported historical session changed",
      409,
    );
}

export async function importRow(
  tx: Prisma.TransactionClient,
  context: {
    serverMachineId: string;
    sourceInstanceId: string;
    users: ReadonlyMap<string, string>;
    sealed: boolean;
  },
  row: ImportPlaybackHistory["rows"][number],
) {
  const { serverMachineId, sourceInstanceId, users, sealed } = context;
  const identity = {
    source: "tautulli",
    sourceInstanceId,
    sourceSessionId: row.id,
  };
  const existing = await tx.playbackSessionIdentity.findUnique({
    where: { source_sourceInstanceId_sourceSessionId: identity },
    include: { session: true },
  });
  if (existing !== null) {
    assertHistoricalSnapshot(existing.session, serverMachineId, row);
    const boundUser = users.get(row.user_id);
    if (boundUser !== undefined && existing.session.userId !== boundUser) {
      if (existing.session.userId !== null)
        throw new MediaError(
          "identity_changed",
          "Historical session is already bound to another account",
          409,
        );
      await tx.playbackSession.update({
        where: { id: existing.session.id },
        data: { userId: boundUser },
      });
    }
    return false;
  }
  if (sealed)
    throw new MediaError(
      "history_sealed",
      "The final historical snapshot is sealed; new rows cannot overlap live collection",
      409,
    );
  await tx.playbackSession.create({
    data: {
      serverMachineId,
      serverAccountId: row.user_id,
      userId: users.get(row.user_id) ?? null,
      ratingKey: row.rating_key,
      title: row.full_title,
      seriesTitle: row.grandparent_title,
      mediaType: row.media_type,
      platform: row.platform,
      playerId: row.player,
      decision: row.transcode_decision,
      startedAt: new Date(row.started * 1000),
      stoppedAt: new Date(row.stopped * 1000),
      lastSeenAt: new Date(row.stopped * 1000),
      durationMs: 0,
      watchedMs: row.duration * 1000,
      maxProgressMs: 0,
      lastProgressMs: 0,
      reportingCompleted: row.percent_complete >= 85,
      state: "stopped",
      source: "tautulli",
      sourceSnapshotDigest: snapshotHash(row),
      identities: { create: identity },
    },
  });
  return true;
}

export async function requireCurrentPlaybackOwner(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
) {
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${actor.id} FOR SHARE`;
  const user = await tx.mediaUser.findUnique({ where: { id: actor.id } });
  if (user === null)
    throw new MediaError(
      "unauthorized",
      "This account is no longer available",
      401,
    );
  requireOwner(user);
  if (user.restricted || user.plexAccountId !== actor.plexAccountId)
    throw new MediaError(
      "forbidden",
      "The current owner must import playback history",
      403,
    );
}

const HandoffReceiptSchema = z.object({
  snapshotDigest: z.string(),
  expectedSessions: z.number(),
  through: z.string(),
  quiescenceCapturedAt: z.string(),
  inventoryDigest: z.string(),
});

export function handoffReplay(
  checkpoint: PlaybackCollector,
  input: SealPlaybackHandoff,
) {
  const stored = HandoffReceiptSchema.safeParse(checkpoint.handoffEvidence);
  return (
    stored.success &&
    stored.data.snapshotDigest === input.snapshotDigest &&
    stored.data.expectedSessions === input.expectedSessions &&
    stored.data.through === input.through &&
    stored.data.quiescenceCapturedAt === input.quiescenceCapturedAt &&
    stored.data.inventoryDigest === input.inventoryDigest
  );
}

export function assertHandoffEvidence(
  input: SealPlaybackHandoff,
  evidence: PlaybackHandoffEvidence,
  now: Date,
) {
  const quiescedAt = new Date(input.quiescenceCapturedAt);
  const through = new Date(input.through);
  const stale = [
    evidence.capturedAt > now,
    evidence.expiresAt <= now,
    quiescedAt > through,
    quiescedAt.getTime() !== evidence.capturedAt.getTime(),
    through > now,
    evidence.inventoryDigest !== input.inventoryDigest,
  ];
  if (stale.some(Boolean))
    throw new MediaError(
      "stale_handoff",
      "A fresh stopped legacy inventory and final historical snapshot are required",
      409,
    );
  return quiescedAt;
}

export async function historicalManifest(
  tx: Pick<Prisma.TransactionClient, "playbackSessionIdentity">,
  sourceInstanceId: string,
  serverMachineId: string,
) {
  const identities = await tx.playbackSessionIdentity.findMany({
    where: {
      source: "tautulli",
      sourceInstanceId,
      session: { serverMachineId },
    },
    select: {
      sourceSessionId: true,
      session: { select: { sourceSnapshotDigest: true } },
    },
    take: 50_001,
  });
  if (identities.length > 50_000)
    throw new MediaError(
      "history_too_large",
      "Historical playback exceeds the supported import bound",
      422,
    );
  const manifest = identities
    .map((identity) => ({
      id: identity.sourceSessionId,
      sha256: identity.session.sourceSnapshotDigest,
    }))
    .sort((left, right) =>
      left.id.localeCompare(right.id, "en", { numeric: false }),
    );
  if (manifest.some((entry) => entry.sha256 === null))
    throw new MediaError(
      "snapshot_incomplete",
      "Historical playback is missing source provenance",
      409,
    );
  return { sessions: manifest.length, snapshotDigest: snapshotHash(manifest) };
}

export async function validateFinalSnapshot(
  tx: Prisma.TransactionClient,
  input: SealPlaybackHandoff,
  serverMachineId: string,
) {
  const manifest = await historicalManifest(
    tx,
    input.sourceInstanceId,
    serverMachineId,
  );
  if (
    manifest.sessions !== input.expectedSessions ||
    manifest.snapshotDigest !== input.snapshotDigest
  )
    throw new MediaError(
      "snapshot_changed",
      "The imported session manifest differs from the reviewed final snapshot",
      409,
    );
}
