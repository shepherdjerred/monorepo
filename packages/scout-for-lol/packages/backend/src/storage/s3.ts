import type { MatchId, RawMatch, RawTimeline } from "@scout-for-lol/data/index.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { saveToS3 } from "@scout-for-lol/backend/storage/s3-helpers.ts";

/**
 * Save a League of Legends match to S3 storage
 * @param match The match data to save
 * @param trackedPlayerAliases Array of tracked player aliases in this match (empty array if none)
 * @returns Promise that resolves when the match is saved
 */
export async function saveMatchToS3(match: RawMatch, trackedPlayerAliases: string[]): Promise<void> {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);
  const body = JSON.stringify(match, null, 2);

  await saveToS3({
    matchId,
    assetType: "match",
    extension: "json",
    body,
    contentType: "application/json",
    metadata: {
      matchId: matchId,
      gameMode: match.info.gameMode,
      queueId: match.info.queueId.toString(),
      participantCount: match.info.participants.length.toString(),
      gameDuration: match.info.gameDuration.toString(),
      gameVersion: match.info.gameVersion,
      result: match.info.endOfGameResult,
      map: match.info.mapId.toString(),
      dataVersion: match.metadata.dataVersion,
      gameType: match.info.gameType,
      trackedPlayers: trackedPlayerAliases.join(", "),
    },
    logEmoji: "💾",
    logMessage: "Saving match to S3",
    errorContext: "match",
    returnUrl: false,
    additionalLogDetails: {
      participants: match.info.participants.length,
      gameMode: match.info.gameMode,
      gameDuration: match.info.gameDuration,
    },
  });
}

/**
 * Save a generated match image (PNG) to S3 storage
 * @param matchId The match ID
 * @param imageBuffer The PNG image buffer
 * @param queueType The queue type (for metadata)
 * @param trackedPlayerAliases Array of tracked player aliases in this match (empty array if none)
 * @returns Promise that resolves to the S3 URL when the image is saved, or undefined if S3 is not configured
 */
export async function saveImageToS3(
  matchId: MatchId,
  imageBuffer: Uint8Array,
  queueType: string,
  trackedPlayerAliases: string[],
): Promise<string | undefined> {
  return saveToS3({
    matchId,
    assetType: "report",
    extension: "png",
    body: imageBuffer,
    contentType: "image/png",
    metadata: {
      matchId: matchId,
      queueType: queueType,
      format: "png",
      trackedPlayers: trackedPlayerAliases.join(", "),
    },
    logEmoji: "🖼️",
    logMessage: "Saving PNG to S3",
    errorContext: "PNG",
    returnUrl: true,
    additionalLogDetails: {
      queueType,
    },
  });
}

/**
 * Save a generated match SVG to S3 storage
 * @param matchId The match ID
 * @param svgContent The SVG content string
 * @param queueType The queue type (for metadata)
 * @param trackedPlayerAliases Array of tracked player aliases in this match (empty array if none)
 * @returns Promise that resolves to the S3 URL when the SVG is saved, or undefined if S3 is not configured
 */
export async function saveSvgToS3(
  matchId: MatchId,
  svgContent: string,
  queueType: string,
  trackedPlayerAliases: string[],
): Promise<string | undefined> {
  return saveToS3({
    matchId,
    assetType: "report",
    extension: "svg",
    body: svgContent,
    contentType: "image/svg+xml",
    metadata: {
      matchId: matchId,
      queueType: queueType,
      format: "svg",
      trackedPlayers: trackedPlayerAliases.join(", "),
    },
    logEmoji: "📄",
    logMessage: "Saving SVG to S3",
    errorContext: "SVG",
    returnUrl: true,
    additionalLogDetails: {
      queueType,
    },
  });
}

/**
 * Save a match timeline to S3 storage
 * @param timeline The timeline data to save
 * @param trackedPlayerAliases Array of tracked player aliases in this match (empty array if none)
 * @returns Promise that resolves when the timeline is saved
 */
export async function saveTimelineToS3(timeline: RawTimeline, trackedPlayerAliases: string[]): Promise<void> {
  const matchId = MatchIdSchema.parse(timeline.metadata.matchId);
  const body = JSON.stringify(timeline, null, 2);

  await saveToS3({
    matchId,
    assetType: "timeline",
    extension: "json",
    body,
    contentType: "application/json",
    metadata: {
      matchId: matchId,
      frameCount: timeline.info.frames.length.toString(),
      frameInterval: timeline.info.frameInterval.toString(),
      dataVersion: timeline.metadata.dataVersion,
      trackedPlayers: trackedPlayerAliases.join(", "),
    },
    logEmoji: "📊",
    logMessage: "Saving timeline to S3",
    errorContext: "timeline",
    returnUrl: false,
    additionalLogDetails: {
      frameCount: timeline.info.frames.length,
      frameInterval: timeline.info.frameInterval,
    },
  });
}
