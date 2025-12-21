import { prisma } from "../index.js";
import { logger } from "../../utils/index.js";

export type TrackPlayInput = {
  guildId: string;
  channelId: string;
  requestedBy: string;
  trackTitle: string;
  trackUrl: string;
  trackDuration?: number;
};

export function recordTrackPlay(input: TrackPlayInput): void {
  // Fire and forget - don't block playback
  void prisma.musicHistory
    .create({
      data: {
        guildId: input.guildId,
        trackUrl: input.trackUrl,
        trackName: input.trackTitle,
        duration: input.trackDuration ?? 0,
        userId: input.requestedBy,
      },
    })
    .catch((error: unknown) => {
      logger.error("Failed to record track play", error);
    });
}

export async function getRecentTracks(
  guildId: string,
  limit: number = 10
): Promise<
  {
    trackName: string;
    trackUrl: string;
    userId: string;
    createdAt: Date;
  }[]
> {
  return prisma.musicHistory.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      trackName: true,
      trackUrl: true,
      userId: true,
      createdAt: true,
    },
  });
}
