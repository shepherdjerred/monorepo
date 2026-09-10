import {
  ExploreMatchCardSchema,
  ExploreMatchSnapshotSchema,
  MatchIdSchema,
  type ExploreMatchCard,
  type ExploreMatchCardRequest,
  type ExploreMatchSnapshot,
  type ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import type { ScoutQlSource } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import {
  fetchFullMatch,
  type LakeMatchParticipantRow,
} from "#src/reports/duckdb/consumer-profile-lake-reads.ts";

function requiredFirst(
  rows: LakeMatchParticipantRow[],
): LakeMatchParticipantRow {
  const first = rows[0];
  if (first === undefined) {
    throw new Error("A requested Explore match card has no match participants");
  }
  return first;
}

function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

/** Arena has multiple competing subteams, not the classic two-team shape. */
export function isExploreMatchSnapshotSupported(gameMode: string): boolean {
  return gameMode !== "CHERRY";
}

/** Convert the lake's normalized participant rows into a neutral match view. */
export function exploreMatchSnapshot(
  rows: LakeMatchParticipantRow[],
): ExploreMatchSnapshot {
  const first = requiredFirst(rows);
  if (rows.some((row) => row.match_id !== first.match_id)) {
    throw new Error("Explore match detail rows contain more than one match");
  }
  if (!isExploreMatchSnapshotSupported(first.game_mode)) {
    throw new Error("Arena matches do not support the Explore match snapshot");
  }
  const grouped = Map.groupBy(rows, (row) => row.team_id);
  const teams = [...grouped.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([teamId, teamRows]) => {
      const teamFirst = requiredFirst(teamRows);
      const kills = teamRows.reduce((total, row) => total + row.kills, 0);
      const damage = teamRows.reduce(
        (total, row) => total + row.total_damage_dealt_to_champions,
        0,
      );
      return {
        teamId,
        win: teamFirst.win,
        kills,
        objectives: teamRows.reduce(
          (total, row) => ({
            turrets: total.turrets + row.turret_kills,
            inhibitors: total.inhibitors + row.inhibitor_kills,
            barons: total.barons + row.baron_kills,
            dragons: total.dragons + row.dragon_kills,
          }),
          { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 },
        ),
        participants: teamRows.map((row) => ({
          participantId: row.participant_id,
          riotId: {
            gameName: row.riot_id_game_name,
            tagLine: row.riot_id_tagline,
          },
          championId: row.champion_id,
          championName: row.champion_name,
          position: row.team_position,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          creepScore: row.creep_score,
          goldEarned: row.gold_earned,
          visionScore: row.vision_score,
          damageToChampions: row.total_damage_dealt_to_champions,
          killParticipation: ratio(row.kills + row.assists, kills),
          damageShare: ratio(row.total_damage_dealt_to_champions, damage),
          objectives: {
            turrets: row.turret_kills,
            inhibitors: row.inhibitor_kills,
            barons: row.baron_kills,
            dragons: row.dragon_kills,
          },
        })),
      };
    });
  return ExploreMatchSnapshotSchema.parse({
    matchId: first.match_id,
    gameCreationMs: first.game_creation_ms,
    gameDurationSeconds: first.game_duration_seconds,
    queue: first.queue,
    queueId: first.queue_id,
    gameMode: first.game_mode,
    gameType: first.game_type,
    gameVersion: first.game_version,
    mapId: first.map_id,
    teams,
  });
}

/**
 * Match artifacts are allowed only for ids returned by the latest report
 * query. The model may choose presentation, never the data it displays.
 */
export function matchIdsInPreview(
  preview: ReportAiPreviewSummary | null,
  source: ScoutQlSource | null,
): Set<string> {
  if (preview === null || source !== "match_participants") return new Set();
  const hasLabelMatchId = preview.columns.some(
    (column) =>
      column.key === "label" && column.label.toLowerCase() === "match id",
  );
  const ids = new Set<string>();
  for (const row of preview.rows) {
    if (hasLabelMatchId) {
      const parsed = MatchIdSchema.safeParse(row.label);
      if (parsed.success) ids.add(parsed.data);
    }
    for (const value of row.values) {
      if (value.column !== "match_id" || typeof value.value !== "string") {
        continue;
      }
      const parsed = MatchIdSchema.safeParse(value.value);
      if (parsed.success) ids.add(parsed.data);
    }
  }
  return ids;
}

export async function hydrateExploreMatchCards(input: {
  requests: ExploreMatchCardRequest[];
  eligibleMatchIds: Set<string>;
}): Promise<ExploreMatchCard[]> {
  const eligible = input.requests.filter((request) =>
    input.eligibleMatchIds.has(request.matchId),
  );
  return await Promise.all(
    eligible.map(async (request) => {
      const rows = await fetchFullMatch({ matchId: request.matchId });
      const first = requiredFirst(rows);
      if (!isExploreMatchSnapshotSupported(first.game_mode)) return null;
      return ExploreMatchCardSchema.parse({
        size: request.size,
        match: exploreMatchSnapshot(rows),
      });
    }),
  ).then((cards) => cards.filter((card) => card !== null));
}
