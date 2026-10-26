import type {
  PlayerConfigEntry,
  RiotMatchId,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import {
  resolveMatchTimeline,
  type TimelinePersistence,
} from "#src/evidence/timelines.ts";
import { recordTimelineForReportStore } from "#src/report-store/live-ingest.ts";

/** Consumers request persistence/coverage; source selection belongs to evidence. */
async function resolvedTimeline(
  match: RawMatch,
  matchId: RiotMatchId,
  players: PlayerConfigEntry[],
  persistence: TimelinePersistence,
): Promise<RawTimeline | undefined> {
  if (match.metadata.matchId !== matchId)
    throw new Error("Timeline request has inconsistent match identity");
  const result = await resolveMatchTimeline({ match, players, persistence });
  if (result.kind === "available") return result.value;
  if (result.kind === "conflict")
    throw new Error(`Conflicting timeline evidence for ${matchId}`);
  if (persistence === "required" && result.kind === "pending")
    throw new Error(`Required timeline pending for ${matchId}`);
  return undefined;
}

export async function fetchTimelineForDare(
  match: RawMatch,
  matchId: RiotMatchId,
  players: PlayerConfigEntry[],
) {
  return await resolvedTimeline(match, matchId, players, "required");
}
export async function fetchTimelineForProgression(
  match: RawMatch,
  matchId: RiotMatchId,
  players: PlayerConfigEntry[],
) {
  return await resolvedTimeline(match, matchId, players, "required");
}
export async function fetchTimelineForDuelProgression(
  match: RawMatch,
  matchId: RiotMatchId,
  players: PlayerConfigEntry[],
) {
  return await resolvedTimeline(
    match,
    matchId,
    players,
    "required_if_available",
  );
}
export async function persistTimelineForProgression(
  timeline: RawTimeline,
  players: PlayerConfigEntry[],
  matchId: RiotMatchId,
  match: RawMatch,
): Promise<void> {
  if (timeline.metadata.matchId !== matchId)
    throw new Error("Timeline persistence has inconsistent match identity");
  const staged = await recordTimelineForReportStore({
    timeline,
    source: "timeline_progression",
    trackedPlayerAliases: players.map((player) => player.alias),
    gameCreatedAt: new Date(match.info.gameCreation),
  });
  if (!staged)
    throw new Error(`Required timeline persistence failed for ${matchId}`);
}
