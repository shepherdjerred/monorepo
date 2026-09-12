import type {
  MatchId,
  RawMatch,
  RawTimeline,
  RawCurrentGameInfo,
} from "@scout-for-lol/data/index.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { saveToS3 } from "#src/storage/s3-helpers.ts";
import type { StoredObject } from "#src/storage/object-integrity.ts";
import { savePrematchToS3 } from "#src/storage/s3-prematch.ts";
import {
  prematchSpectatorPayloadSavesTotal,
  prematchSpectatorPayloadSaveDurationSeconds,
} from "#src/metrics/index.ts";
import { trackedPlayerCountMetadata } from "#src/storage/s3-metadata.ts";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
  type ArtifactKind,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";

export type PrematchPayloadSaveResult = {
  status: "saved" | "skipped_no_bucket";
  durationSeconds?: number;
  /** Present exactly when `status` is `saved`. */
  artifact?: ArtifactDescriptor;
};

/**
 * The outcome of archiving one raw capture: either the descriptor of the object
 * that now exists, or the dev/test no-op when no bucket is configured.
 *
 * The descriptor is built from what the put actually stored — the real key and
 * the digest of the exact bytes uploaded — so it is usable as durable evidence
 * rather than a restatement of intent.
 */
export type RawArchiveResult =
  | { status: "saved"; artifact: ArtifactDescriptor }
  | { status: "skipped_no_bucket" };

function describeArchived(
  kind: ArtifactKind,
  stored: StoredObject,
): ArtifactDescriptor {
  return ArtifactDescriptorSchema.parse({
    kind,
    key: stored.key,
    digest: stored.digest,
    bytes: stored.bytes,
    contentType: stored.contentType,
    capturedAt: stored.capturedAt,
  });
}

function archived(kind: ArtifactKind, stored: StoredObject): RawArchiveResult {
  return { status: "saved", artifact: describeArchived(kind, stored) };
}

/**
 * Archive a League of Legends match to S3 and describe what was stored.
 * @param match The match data to save
 * @param trackedPlayerAliases Array of tracked player aliases in this match (empty array if none)
 */
export async function archiveMatchToS3(
  match: RawMatch,
  trackedPlayerAliases: string[],
): Promise<RawArchiveResult> {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);
  const body = JSON.stringify(match, null, 2);

  const stored = await saveToS3({
    matchId,
    assetType: "match",
    extension: "json",
    body,
    contentType: "application/json",
    metadata: {
      matchId: matchId,
      gameMode: match.info.gameMode,
      gameCreation: match.info.gameCreation.toString(),
      gameEndTimestamp: match.info.gameEndTimestamp.toString(),
      queueId: match.info.queueId.toString(),
      participantCount: match.info.participants.length.toString(),
      gameDuration: match.info.gameDuration.toString(),
      gameVersion: match.info.gameVersion,
      // S3 object metadata values must be strings. Riot omits this for custom
      // games, and "unknown" is the honest label for a field never sent.
      result: match.info.endOfGameResult ?? "unknown",
      map: match.info.mapId.toString(),
      dataVersion: match.metadata.dataVersion,
      gameType: match.info.gameType,
      ...trackedPlayerCountMetadata(trackedPlayerAliases),
    },
    logEmoji: "💾",
    logMessage: "Saving match to S3",
    errorContext: "match",
    keyDate: new Date(match.info.gameCreation),
    additionalLogDetails: {
      participants: match.info.participants.length,
      gameMode: match.info.gameMode,
      gameDuration: match.info.gameDuration,
    },
  });
  return stored === undefined
    ? { status: "skipped_no_bucket" }
    : archived("match", stored);
}

/**
 * Save a League of Legends match to S3 storage
 * @returns whether the canonical write happened or S3 is unavailable
 */
export async function saveMatchToS3(
  match: RawMatch,
  trackedPlayerAliases: string[],
): Promise<"saved" | "skipped_no_bucket"> {
  const result = await archiveMatchToS3(match, trackedPlayerAliases);
  return result.status;
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
  const stored = await saveToS3({
    matchId,
    assetType: "report",
    extension: "png",
    body: imageBuffer,
    contentType: "image/png",
    metadata: {
      matchId: matchId,
      queueType: queueType,
      format: "png",
      ...trackedPlayerCountMetadata(trackedPlayerAliases),
    },
    logEmoji: "🖼️",
    logMessage: "Saving PNG to S3",
    errorContext: "PNG",
    additionalLogDetails: {
      queueType,
    },
  });
  return stored?.url;
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
  const stored = await saveToS3({
    matchId,
    assetType: "report",
    extension: "svg",
    body: svgContent,
    contentType: "image/svg+xml",
    metadata: {
      matchId: matchId,
      queueType: queueType,
      format: "svg",
      ...trackedPlayerCountMetadata(trackedPlayerAliases),
    },
    logEmoji: "📄",
    logMessage: "Saving SVG to S3",
    errorContext: "SVG",
    additionalLogDetails: {
      queueType,
    },
  });
  return stored?.url;
}

/**
 * Persist the raw spectator API payload to S3. S3 is the canonical prematch
 * store, so a failed upload is a hard error: record the failure metric and
 * re-throw so the ingest path fails loud (the caller retries next poll). The
 * missing-bucket path stays a graceful no-op for dev/test — a boot-time guard
 * (src/index.ts) prevents that from ever happening in beta/prod.
 */
export async function savePrematchDataToS3(
  gameId: number,
  gameInfo: RawCurrentGameInfo,
  trackedPlayerAliases: string[],
): Promise<PrematchPayloadSaveResult> {
  const body = JSON.stringify(gameInfo, null, 2);
  const startTime = Date.now();

  try {
    const stored = await savePrematchToS3({
      gameId,
      assetType: "spectator-data",
      extension: "json",
      body,
      contentType: "application/json",
      metadata: {
        gameId: gameId.toString(),
        gameMode: gameInfo.gameMode,
        queueId: gameInfo.gameQueueConfigId.toString(),
        participantCount: gameInfo.participants.length.toString(),
        ...trackedPlayerCountMetadata(trackedPlayerAliases),
      },
      logEmoji: "📡",
      logMessage: "Saving spectator data to S3",
      errorContext: "prematch-data",
    });

    if (stored === undefined) {
      prematchSpectatorPayloadSavesTotal.inc({ status: "skipped_no_bucket" });
      return { status: "skipped_no_bucket" };
    }

    const durationSeconds = (Date.now() - startTime) / 1000;
    prematchSpectatorPayloadSaveDurationSeconds.observe(durationSeconds);
    prematchSpectatorPayloadSavesTotal.inc({ status: "saved" });
    return {
      status: "saved",
      durationSeconds,
      artifact: describeArchived("prematch", stored),
    };
  } catch (error) {
    const durationSeconds = (Date.now() - startTime) / 1000;
    prematchSpectatorPayloadSaveDurationSeconds.observe(durationSeconds);
    prematchSpectatorPayloadSavesTotal.inc({ status: "error" });
    throw error;
  }
}

/**
 * Save a loading screen PNG image to S3.
 */
export async function savePrematchImageToS3(
  gameId: number,
  imageBuffer: Uint8Array,
  queueType: string,
  trackedPlayerAliases: string[],
): Promise<string | undefined> {
  const stored = await savePrematchToS3({
    gameId,
    assetType: "loading-screen",
    extension: "png",
    body: imageBuffer,
    contentType: "image/png",
    metadata: {
      gameId: gameId.toString(),
      queueType,
      format: "png",
      ...trackedPlayerCountMetadata(trackedPlayerAliases),
    },
    logEmoji: "🖼️",
    logMessage: "Saving loading screen PNG to S3",
    errorContext: "prematch-image",
  });
  return stored?.url;
}

/**
 * Save a loading screen SVG to S3.
 */
export async function savePrematchSvgToS3(
  gameId: number,
  svgContent: string,
  queueType: string,
  trackedPlayerAliases: string[],
): Promise<string | undefined> {
  const stored = await savePrematchToS3({
    gameId,
    assetType: "loading-screen",
    extension: "svg",
    body: svgContent,
    contentType: "image/svg+xml",
    metadata: {
      gameId: gameId.toString(),
      queueType,
      format: "svg",
      ...trackedPlayerCountMetadata(trackedPlayerAliases),
    },
    logEmoji: "📄",
    logMessage: "Saving loading screen SVG to S3",
    errorContext: "prematch-svg",
  });
  return stored?.url;
}

/**
 * Archive a match timeline to S3 and describe what was stored.
 *
 * PARTITION CUTOVER (2026-09-12): timelines are keyed by the match's
 * `gameCreation`, exactly like the match payload, so every asset for a game
 * shares one `games/yyyy/MM/dd/{matchId}/` prefix. Before this change the
 * timeline used the upload time instead, which put it under the day it was
 * fetched — usually, but not always, the day the game was played. Objects
 * written before the cutover keep their old location; nothing rewrites them.
 * Readers must therefore tolerate both, which they do by enumerating the whole
 * `games/` prefix and taking identity from the payload rather than the key
 * (see `report-lake/rebuild-sources.ts`).
 *
 * @param timeline The timeline data to save
 * @param trackedPlayerAliases Array of tracked player aliases in this match (empty array if none)
 * @param gameCreatedAt The match's `info.gameCreation`, which partitions the key
 */
export async function archiveTimelineToS3(
  timeline: RawTimeline,
  trackedPlayerAliases: string[],
  gameCreatedAt: Date,
): Promise<RawArchiveResult> {
  const matchId = MatchIdSchema.parse(timeline.metadata.matchId);
  const body = JSON.stringify(timeline, null, 2);

  const stored = await saveToS3({
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
      ...trackedPlayerCountMetadata(trackedPlayerAliases),
    },
    logEmoji: "📊",
    logMessage: "Saving timeline to S3",
    errorContext: "timeline",
    keyDate: gameCreatedAt,
    additionalLogDetails: {
      frameCount: timeline.info.frames.length,
      frameInterval: timeline.info.frameInterval,
    },
  });
  return stored === undefined
    ? { status: "skipped_no_bucket" }
    : archived("timeline", stored);
}

/**
 * Save a match timeline to S3 storage
 * @returns Promise that resolves when the timeline is saved
 */
export async function saveTimelineToS3(
  timeline: RawTimeline,
  trackedPlayerAliases: string[],
  gameCreatedAt: Date,
): Promise<void> {
  await archiveTimelineToS3(timeline, trackedPlayerAliases, gameCreatedAt);
}
