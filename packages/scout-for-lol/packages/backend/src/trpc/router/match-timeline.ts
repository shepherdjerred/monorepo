import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  fetchTimelineEventPage,
  fetchTimelineFramePage,
  fetchTimelineCoverage,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import {
  fetchTimelineReviewFrames,
  fetchTimelineReviewParticipants,
} from "#src/reports/duckdb/consumer/timeline-review-reads.ts";

export const MATCH_TIMELINE_PAGE_SIZE = 100;
export const MATCH_KEY_EVENT_TYPES = [
  "CHAMPION_KILL",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "GAME_END",
];

/** Call only after the surface's match authorization has succeeded. */
export async function fetchMatchReviewTimeline(input: {
  matchId: RiotMatchId;
}) {
  const coverage = await fetchTimelineCoverage(input);
  if (coverage === null) return { coverage, frames: [], events: [] };
  const [frames, events, participants] = await Promise.all([
    fetchTimelineReviewFrames(input),
    fetchTimelineEventPage({
      ...input,
      offset: 0,
      // Coverage is the number of all events, so this includes every key event.
      limit: coverage.event_count,
      eventTypes: MATCH_KEY_EVENT_TYPES,
    }),
    fetchTimelineReviewParticipants(input),
  ]);
  const participantIds = new Map<string, number[]>();
  for (const row of participants) {
    const ids = participantIds.get(row.event_id) ?? [];
    ids.push(row.participant_id);
    participantIds.set(row.event_id, ids);
  }
  return {
    coverage,
    frames,
    events: events.map((event) => ({
      id: event.event_id,
      timestampMs: event.event_timestamp_ms,
      type: event.event_type,
      killerId: event.killer_id,
      victimId: event.victim_id,
      teamId: event.team_id,
      killerTeamId: event.killer_team_id,
      winningTeamId: event.winning_team_id,
      monster: event.monster_type,
      monsterSubtype: event.monster_sub_type,
      building: event.building_type,
      tower: event.tower_type,
      lane: event.lane_type,
      participantIds: participantIds.get(event.event_id) ?? [],
    })),
  };
}

type TimelinePageInput = {
  matchId: RiotMatchId;
  participantIds?: number[] | undefined;
  cursor?: { offset: number } | undefined;
};

type TimelineEventPageInput = TimelinePageInput & {
  eventTypes?: string[] | undefined;
};

function pageResult<T>(rows: T[], offset: number) {
  const page = rows.slice(0, MATCH_TIMELINE_PAGE_SIZE);
  return {
    rows: page,
    nextCursor:
      rows.length > MATCH_TIMELINE_PAGE_SIZE
        ? { offset: offset + MATCH_TIMELINE_PAGE_SIZE }
        : null,
  };
}

function participantFilter(participantIds: number[] | undefined) {
  return participantIds === undefined ? {} : { participantIds };
}

export async function fetchMatchTimelineEvents(input: TimelineEventPageInput) {
  const offset = input.cursor?.offset ?? 0;
  const rows = await fetchTimelineEventPage({
    matchId: input.matchId,
    offset,
    limit: MATCH_TIMELINE_PAGE_SIZE + 1,
    ...(input.eventTypes === undefined ? {} : { eventTypes: input.eventTypes }),
    ...participantFilter(input.participantIds),
  });
  return pageResult(rows, offset);
}

export async function fetchMatchTimelineFrames(input: TimelinePageInput) {
  const offset = input.cursor?.offset ?? 0;
  const rows = await fetchTimelineFramePage({
    matchId: input.matchId,
    offset,
    limit: MATCH_TIMELINE_PAGE_SIZE + 1,
    ...participantFilter(input.participantIds),
  });
  return pageResult(rows, offset);
}
