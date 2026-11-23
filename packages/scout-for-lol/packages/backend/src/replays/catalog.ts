import {
  PublicReplayDescriptorSchema,
  type PublicReplayDescriptor,
  type PublicReplayPlayback,
} from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { prisma } from "#src/database/index.ts";

const select = {
  id: true,
  platformId: true,
  gameId: true,
  digest: true,
  objectKey: true,
  bytes: true,
  gameBuild: true,
  protocol: true,
  durationSeconds: true,
  mapId: true,
  gameMode: true,
  teamSizes: true,
} as const;

export type StoredPublicReplay = {
  readonly id: string;
  readonly platformId: string | null;
  readonly gameId: string;
  readonly digest: string;
  readonly objectKey: string;
  readonly bytes: bigint;
  readonly gameBuild: string | null;
  readonly protocol: string | null;
  readonly durationSeconds: number | null;
  readonly mapId: number | null;
  readonly gameMode: string | null;
  readonly teamSizes: unknown;
};

export type PublicReplayIdentity = Omit<PublicReplayDescriptor, "playback">;
export type ReplaySupportResolver = (
  replay: PublicReplayIdentity,
) => Promise<PublicReplayPlayback>;

/** Safe until an upstream patch observation and admitted package are supplied. */
export const unobservedReplaySupport: ReplaySupportResolver = async (
  replay,
) => {
  await Promise.resolve();
  if (
    replay.gameBuild === null ||
    replay.protocol === null ||
    replay.durationSeconds === null
  )
    return { status: "metadata_pending" };
  if (replay.platformId === null)
    return {
      status: "incompatible",
      latestPatch: null,
      reason: "unqualified_platform",
    };
  return {
    status: "support_preparing",
    latestPatch: null,
    reason: "patch_unobserved",
  };
};

export async function describePublicReplay(
  replay: StoredPublicReplay,
  resolveSupport: ReplaySupportResolver,
): Promise<PublicReplayDescriptor> {
  const identity: PublicReplayIdentity = {
    replayId: replay.id,
    matchId:
      replay.platformId === null
        ? null
        : `${replay.platformId}_${replay.gameId}`,
    platformId: replay.platformId,
    gameId: replay.gameId,
    bytes: Number(replay.bytes),
    sha256: replay.digest,
    gameBuild: replay.gameBuild,
    protocol: replay.protocol,
    durationSeconds: replay.durationSeconds,
    mapId: replay.mapId,
    gameMode: replay.gameMode,
    teamSizes: PublicReplayDescriptorSchema.shape.teamSizes.parse(
      replay.teamSizes,
    ),
  };
  return PublicReplayDescriptorSchema.parse({
    ...identity,
    playback: await resolveSupport(identity),
  });
}

export async function findPublicReplay(
  replayId: string,
): Promise<StoredPublicReplay | null> {
  return await prisma.scoutClientReplayArtifact.findFirst({
    where: { id: replayId, uploadState: "COMPLETED" },
    select,
  });
}

export async function findPublicMatchReplays(
  platformId: string,
  gameId: string,
): Promise<StoredPublicReplay[]> {
  return await prisma.scoutClientReplayArtifact.findMany({
    where: { platformId, gameId, uploadState: "COMPLETED" },
    orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    select,
  });
}
