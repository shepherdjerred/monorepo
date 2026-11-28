import type { LakeMatchParticipantRow } from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import type {
  MatchStoryRead,
  StoryEvent,
} from "#src/reports/duckdb/consumer/match-story-reads.ts";
import {
  matchRowChampionName,
  matchRowLoadout,
  orderMatchRows,
} from "#src/explore-match/match-row-view.ts";
import { normalizeRiotIdPart } from "#src/explore-match/match-view.ts";
import { buildGoldLead } from "#src/trpc/router/consumer/match-gold-lead.ts";
import {
  buildOrderFor,
  skillOrderFor,
} from "#src/trpc/router/consumer/match-story-builds.ts";
import { buildMoments } from "#src/trpc/router/consumer/match-story-moments.ts";
import type { StoryRosterEntry } from "#src/trpc/router/consumer/match-story-fights.ts";
import {
  teamObjectives,
  type ParticipantObjectives,
} from "#src/trpc/router/consumer/match-team-objectives.ts";

/**
 * Whether the game was remade: Riot ended it before the result counted. The
 * lake states this on every participant row; one row is enough.
 */
export function matchWasRemade(
  rows: readonly Pick<
    LakeMatchParticipantRow,
    "early_surrendered" | "end_of_game_result"
  >[],
): boolean {
  return rows.some(
    (row) =>
      row.early_surrendered ||
      (row.end_of_game_result !== null &&
        row.end_of_game_result !== "GameComplete"),
  );
}

type AliasLookup = ReadonlyMap<string, readonly { alias: string }[]>;

function displayNameOf(
  row: LakeMatchParticipantRow,
  aliasesByPuuid: AliasLookup,
): string {
  const alias =
    row.puuid === null
      ? undefined
      : aliasesByPuuid.get(row.puuid)?.at(0)?.alias;
  return (
    alias ??
    normalizeRiotIdPart(row.riot_id_game_name) ??
    matchRowChampionName(row)
  );
}

function winnerOf(rows: readonly LakeMatchParticipantRow[]): number | null {
  const winners = new Set(
    rows.filter((row) => row.win).map((row) => row.team_id),
  );
  const [only] = [...winners];
  return only !== undefined && winners.size === 1 ? only : null;
}

function objectivesOf(row: LakeMatchParticipantRow): ParticipantObjectives {
  return {
    turrets: row.turret_kills,
    inhibitors: row.inhibitor_kills,
    barons: row.baron_kills,
    dragons: row.dragon_kills,
  };
}

/**
 * The Match page's story from one lake read. A match with no timeline gets the
 * end-of-game facts only (`coverage: "end_of_game"`): each player's final
 * items and each team's objectives, with no moments, build orders or lead.
 */
export function buildMatchStory(options: {
  read: MatchStoryRead;
  aliasesByPuuid: AliasLookup;
  /** The viewer's own accounts; the gold lead is measured for their team. */
  viewerPuuids: ReadonlySet<string>;
}) {
  const { read } = options;
  const rows = orderMatchRows(read.rows);
  const first = rows[0];
  if (first === undefined) throw new Error("Story has no participants");
  const remake = matchWasRemade(rows);
  const winnerTeamId = remake ? null : winnerOf(rows);
  const roster = new Map<number, StoryRosterEntry>();
  for (const row of rows) {
    if (row.participant_id === null) continue;
    roster.set(row.participant_id, {
      teamId: row.team_id,
      championId: row.champion_id,
      championName: matchRowChampionName(row),
      displayName: displayNameOf(row, options.aliasesByPuuid),
    });
  }
  const timeline = read.hasTimeline;
  const eventsByParticipant = new Map<number, StoryEvent[]>();
  for (const event of read.events) {
    if (event.participant_id === null) continue;
    const list = eventsByParticipant.get(event.participant_id) ?? [];
    list.push(event);
    eventsByParticipant.set(event.participant_id, list);
  }
  const viewerRow = rows.find(
    (row) => row.puuid !== null && options.viewerPuuids.has(row.puuid),
  );
  const teamByParticipant = new Map(
    [...roster.entries()].map(([id, entry]) => [id, entry.teamId] as const),
  );
  return {
    matchId: first.match_id,
    coverage: timeline ? ("timeline" as const) : ("end_of_game" as const),
    remake,
    durationSeconds: first.game_duration_seconds,
    winnerTeamId,
    moments: timeline
      ? buildMoments({
          events: read.events,
          assists: read.assists,
          frames: read.frames,
          roster,
          winnerTeamId,
        })
      : [],
    goldLead:
      timeline && viewerRow !== undefined
        ? buildGoldLead({
            frames: read.frames,
            teamByParticipant,
            viewerTeamId: viewerRow.team_id,
          })
        : null,
    participants: rows.map((row) => {
      const events =
        row.participant_id === null
          ? []
          : (eventsByParticipant.get(row.participant_id) ?? []);
      return {
        participantId: row.participant_id,
        teamId: row.team_id,
        championId: row.champion_id,
        championName: matchRowChampionName(row),
        displayName: displayNameOf(row, options.aliasesByPuuid),
        selectedPlayer:
          row.puuid !== null && options.viewerPuuids.has(row.puuid),
        finalItemIds: matchRowLoadout(row).itemIds.filter((id) => id > 0),
        buildOrder: timeline ? buildOrderFor(events) : null,
        skillOrder: timeline ? skillOrderFor(events) : null,
      };
    }),
    teams: [...new Set(rows.map((row) => row.team_id))].map((teamId) => {
      const teamRows = rows.filter((row) => row.team_id === teamId);
      return {
        teamId,
        win: teamRows[0]?.win ?? false,
        objectives: teamObjectives(
          teamRows.map((row) => ({ objectives: objectivesOf(row) })),
        ),
      };
    }),
  };
}
