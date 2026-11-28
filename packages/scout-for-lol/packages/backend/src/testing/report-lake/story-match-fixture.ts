import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  TimelineCoverageLakeRow,
  TimelineEventLakeRow,
  TimelineEventParticipantLakeRow,
  TimelineParticipantFrameLakeRow,
} from "@scout-for-lol/data";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";
import { storyDraftEvents } from "#src/testing/report-lake/story-match-events.ts";
import {
  STORY_DURATION_MINUTES,
  STORY_GOLD_LEAD_BY_MINUTE,
  STORY_SEATS,
  STORY_VIEWER_PARTICIPANT_ID,
} from "#src/testing/report-lake/story-match-seats.ts";
import {
  testEventRow,
  testFrameRow,
} from "#src/testing/report-lake/test-timeline-rows.ts";

/**
 * A ranked Summoner's Rift game shaped like a real one: ten players, a
 * 28-minute timeline with a frame per minute, purchases (with an undone buy and
 * a sale), skill points, first blood, a triple kill, an ace, objectives, and a
 * win for the blue team. Participants are numbered 1 to 10; the viewer is
 * participant 3 (blue mid).
 */

export type StoryMatchFixture = {
  /** The viewer's own row, the only tracked one. */
  matchFacts: TestLakeMatchFact[];
  untrackedMatchFacts: TestLakeMatchFact[];
  timelineFrames: TimelineParticipantFrameLakeRow[];
  timelineEvents: TimelineEventLakeRow[];
  timelineEventParticipants: TimelineEventParticipantLakeRow[];
  timelineCoverage: TimelineCoverageLakeRow[];
};

function frames(
  matchId: RiotMatchId,
  gameCreationAt: Date,
  puuidOf: (participantId: number) => LeaguePuuid,
): TimelineParticipantFrameLakeRow[] {
  return Array.from({ length: STORY_DURATION_MINUTES + 1 }, (_, minute) =>
    STORY_SEATS.map((seat) => {
      const redGold = 500 + 330 * minute;
      const lead = STORY_GOLD_LEAD_BY_MINUTE[minute] ?? 0;
      return {
        ...testFrameRow({
          matchId,
          gameCreationAt,
          puuid: puuidOf(seat.participantId),
          participantId: seat.participantId,
          minute,
          totalGold:
            seat.teamId === 100 ? redGold + Math.round(lead / 5) : redGold,
          minions: minute * 6,
          jungle: seat.position === "JUNGLE" ? minute * 3 : 0,
        }),
        level: Math.min(18, 1 + Math.floor(minute * 0.6)),
      };
    }),
  ).flat();
}

function timeline(matchId: RiotMatchId, gameCreationAt: Date) {
  const perFrame = new Map<number, number>();
  const events: TimelineEventLakeRow[] = [];
  const participants: TimelineEventParticipantLakeRow[] = [];
  for (const draft of storyDraftEvents()) {
    const frameIndex = Math.floor(draft.ts / 60_000);
    const eventIndex = perFrame.get(frameIndex) ?? 0;
    perFrame.set(frameIndex, eventIndex + 1);
    const eventId = `${matchId}:${frameIndex.toString()}:${eventIndex.toString()}`;
    events.push(
      testEventRow(gameCreationAt, {
        ...draft.fields,
        event_id: eventId,
        match_id: matchId,
        event_timestamp_ms: draft.ts,
        frame_index: frameIndex,
        event_index: eventIndex,
        frame_timestamp_ms: frameIndex * 60_000,
      }),
    );
    for (const [roleIndex, entry] of draft.participants.entries()) {
      participants.push({
        event_id: eventId,
        match_id: matchId,
        month: lakeMonth(gameCreationAt.getTime()),
        observed_at: lakeTimestamp(gameCreationAt.getTime()),
        participant_id: entry.id,
        puuid: null,
        role: entry.role,
        role_index: roleIndex,
      });
    }
  }
  return { events, participants };
}

type StoryMatchOptions = {
  matchId: RiotMatchId;
  gameCreationAt: Date;
  /** The tracked player, seated as blue mid. */
  viewer: { playerId: number; playerAlias: string; puuid: LeaguePuuid };
  puuidOf: (participantId: number) => LeaguePuuid;
  /** `false` for a game the lake holds no timeline for. */
  withTimeline?: boolean;
  /** A game Riot ended early, with no result. */
  remake?: boolean;
  queueId?: number;
};

function matchFacts(options: StoryMatchOptions): TestLakeMatchFact[] {
  const common = {
    matchId: options.matchId,
    queue: "solo",
    queueId: options.queueId ?? 420,
    gameCreationAt: options.gameCreationAt,
    surrendered: false,
    gameDurationSeconds: STORY_DURATION_MINUTES * 60,
    ...(options.remake === true ? { earlySurrendered: true } : {}),
  };
  return STORY_SEATS.map((seat): TestLakeMatchFact => {
    const isViewer = seat.participantId === STORY_VIEWER_PARTICIPANT_ID;
    return {
      ...common,
      playerId: isViewer ? options.viewer.playerId : 1000 + seat.participantId,
      playerAlias: isViewer ? options.viewer.playerAlias : seat.riotId,
      puuid: isViewer
        ? options.viewer.puuid
        : options.puuidOf(seat.participantId),
      participantId: seat.participantId,
      riotIdGameName: isViewer ? options.viewer.playerAlias : seat.riotId,
      teamId: seat.teamId,
      win: seat.teamId === 100,
      kills: seat.kills,
      deaths: seat.deaths,
      assists: seat.assists,
      championId: seat.championId,
      championName: seat.championName,
      teamPosition: seat.position,
      totalDamageDealtToChampions: seat.damage,
    };
  });
}

/** The lake inputs for the story match; see the module comment. */
export function storyMatchFixture(
  options: StoryMatchOptions,
): StoryMatchFixture {
  const facts = matchFacts(options);
  const viewerFact = facts.find(
    (fact) => fact.participantId === STORY_VIEWER_PARTICIPANT_ID,
  );
  if (viewerFact === undefined) throw new Error("Story fixture has no viewer");
  const { matchId, gameCreationAt } = options;
  const withTimeline = options.withTimeline ?? true;
  const built = withTimeline ? timeline(matchId, gameCreationAt) : null;
  return {
    matchFacts: [viewerFact],
    untrackedMatchFacts: facts.filter((fact) => fact !== viewerFact),
    timelineFrames: withTimeline
      ? frames(matchId, gameCreationAt, (id) =>
          id === STORY_VIEWER_PARTICIPANT_ID
            ? options.viewer.puuid
            : options.puuidOf(id),
        )
      : [],
    timelineEvents: built?.events ?? [],
    timelineEventParticipants: built?.participants ?? [],
    timelineCoverage:
      built === null
        ? []
        : [
            {
              match_id: matchId,
              month: lakeMonth(gameCreationAt.getTime()),
              observed_at: lakeTimestamp(gameCreationAt.getTime()),
              coverage_state: "complete",
              data_version: "2",
              frame_interval_ms: 60_000,
              frame_count: STORY_DURATION_MINUTES + 1,
              event_count: built.events.length,
              participant_count: 10,
              first_frame_timestamp_ms: 23,
              last_frame_timestamp_ms: STORY_DURATION_MINUTES * 60_000 + 23,
            },
          ],
  };
}
