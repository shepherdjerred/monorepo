import {
  fetchTimelineEventPage,
  fetchTimelineFramePage,
} from "#src/reports/duckdb/consumer-profile-lake-reads.ts";

export const MATCH_TIMELINE_PAGE_SIZE = 100;
export const MATCH_KEY_EVENT_TYPES = [
  "CHAMPION_KILL",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "GAME_END",
];

type TimelinePageInput = {
  matchId: string;
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
