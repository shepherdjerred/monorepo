import type {
  RawMatch,
  RawTimeline,
  RawTimelineEvent,
} from "@scout-for-lol/data";
import {
  PublicReplayTimelineEventTypeSchema,
  PublicReplayTimelineObjectiveSchema,
  PublicReplayTimelineResponseSchema,
  type PublicReplayTimeline,
  type PublicReplayTimelineEvent,
} from "@scout-for-lol/domain/artifacts/public-replay-timeline.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import {
  readArchivedMatchPayload,
  readArchivedTimelinePayload,
} from "#src/report-lake/receipted-archive.ts";
import { timelineMatchesResult } from "#src/scout-client/canonical-match.ts";
import {
  MAX_DURATION_DRIFT_MS,
  sameGameBuild,
} from "#src/scout-client/replay/container.ts";
import type { StoredPublicReplay } from "./catalog.ts";

// Standard public Summoner’s Rift matchmaking queues. Exclude customs and
// organized tournament queues, even when their map, mode and roster match.
const PUBLIC_RIFT_QUEUES = new Set([400, 420, 430, 440, 480, 490]);
const MAX_PUBLIC_ARCHIVE_BYTES = 16 * 1024 * 1024;

function matchesPublicReplay(
  replay: StoredPublicReplay,
  matchId: RiotMatchId,
  match: RawMatch,
): boolean {
  const { info, metadata } = match;
  return (
    metadata.dataVersion === "2" &&
    metadata.matchId === matchId &&
    info.platformId.toUpperCase() === replay.platformId &&
    Number.isSafeInteger(info.gameId) &&
    info.gameId > 0 &&
    String(info.gameId) === replay.gameId &&
    info.gameType === "MATCHED_GAME" &&
    info.mapId === 11 &&
    info.gameMode === "CLASSIC" &&
    PUBLIC_RIFT_QUEUES.has(info.queueId) &&
    info.participants.length === 10 &&
    info.participants.filter((player) => player.teamId === 100).length === 5 &&
    info.participants.filter((player) => player.teamId === 200).length === 5 &&
    replay.gameBuild !== null &&
    sameGameBuild(replay.gameBuild, info.gameVersion) &&
    replay.durationSeconds !== null &&
    replay.durationSeconds > 0 &&
    info.gameDuration > 0 &&
    Math.abs(replay.durationSeconds * 1000 - info.gameDuration * 1000) <=
      MAX_DURATION_DRIFT_MS
  );
}

function projectEvent(
  event: RawTimelineEvent,
  id: number,
): PublicReplayTimelineEvent | null {
  const type = PublicReplayTimelineEventTypeSchema.safeParse(event.type);
  if (!type.success) return null;

  const descriptions =
    type.data === "ELITE_MONSTER_KILL"
      ? [event.monsterSubType, event.monsterType]
      : type.data === "BUILDING_KILL"
        ? [event.towerType, event.buildingType]
        : [];
  const objective = descriptions.find(
    (candidate) =>
      PublicReplayTimelineObjectiveSchema.safeParse(candidate).success,
  );
  // Building `teamId` is the objective's side, not a credited actor's side.
  const team =
    type.data === "GAME_END"
      ? event.winningTeam
      : type.data === "ELITE_MONSTER_KILL"
        ? event.killerTeamId
        : undefined;

  return {
    id,
    timestampMs: event.timestamp,
    type: type.data,
    objective:
      objective === undefined
        ? null
        : PublicReplayTimelineObjectiveSchema.parse(objective),
    teamId: team === 100 || team === 200 ? team : null,
  };
}

/** Only selected game facts cross the public transport boundary. */
export function projectPublicReplayTimeline(
  replay: StoredPublicReplay,
  matchId: RiotMatchId,
  match: RawMatch,
  timeline: RawTimeline,
): PublicReplayTimeline | null {
  const duration = replay.durationSeconds;
  if (
    duration === null ||
    !matchesPublicReplay(replay, matchId, match) ||
    timeline.metadata.dataVersion !== "2" ||
    !Number.isSafeInteger(timeline.info.gameId) ||
    String(timeline.info.gameId) !== replay.gameId ||
    !timelineMatchesResult(timeline, match) ||
    new Set(timeline.info.participants.map((player) => player.participantId))
      .size !== match.info.participants.length
  )
    return null;

  const events: PublicReplayTimelineEvent[] = [];
  const lastTimestampMs = Math.floor(duration * 1000 + MAX_DURATION_DRIFT_MS);
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      const projected = projectEvent(event, events.length);
      if (projected === null) continue;
      if (
        !Number.isSafeInteger(projected.timestampMs) ||
        projected.timestampMs < 0 ||
        projected.timestampMs > lastTimestampMs
      )
        return null;
      events.push(projected);
    }
  }
  if (events.length === 0) return null;
  events.sort((left, right) => left.timestampMs - right.timestampMs);
  return PublicReplayTimelineResponseSchema.parse({
    timeline: { source: "riot_match_timeline", events },
  }).timeline;
}

export async function readPublicReplayTimeline(
  replay: StoredPublicReplay,
  signal: AbortSignal,
): Promise<PublicReplayTimeline | null> {
  signal.throwIfAborted();
  const gameId = Number(replay.gameId);
  if (
    replay.platformId === null ||
    replay.gameBuild === null ||
    replay.durationSeconds === null ||
    !Number.isFinite(replay.durationSeconds) ||
    replay.durationSeconds <= 0 ||
    !Number.isSafeInteger(gameId) ||
    gameId <= 0
  )
    return null;
  const matchId = RiotMatchIdSchema.safeParse(
    `${replay.platformId}_${replay.gameId}`,
  );
  if (!matchId.success) return null;
  const [result, timeline] = await Promise.all([
    storedRawArchiveDescriptor(prisma, matchId.data, "match"),
    storedRawArchiveDescriptor(prisma, matchId.data, "timeline"),
  ]);
  if (
    result === null ||
    timeline === null ||
    result.bytes === 0 ||
    timeline.bytes === 0 ||
    result.bytes > MAX_PUBLIC_ARCHIVE_BYTES ||
    timeline.bytes > MAX_PUBLIC_ARCHIVE_BYTES
  )
    return null;

  const matchPayload = await readArchivedMatchPayload(result, matchId.data, {
    signal,
  });
  if (!matchesPublicReplay(replay, matchId.data, matchPayload)) return null;
  const timelinePayload = await readArchivedTimelinePayload(
    timeline,
    matchId.data,
    { signal },
  );
  return projectPublicReplayTimeline(
    replay,
    matchId.data,
    matchPayload,
    timelinePayload,
  );
}
