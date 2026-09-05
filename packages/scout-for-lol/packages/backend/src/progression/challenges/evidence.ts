import {
  ChallengeEvidenceMatchSchema,
  type ChallengeEvidenceMatch,
} from "@scout-for-lol/data";
import {
  fetchProgressionMatches,
  fetchTimelineEventCounts,
  type ProgressionMatchCursor,
} from "#src/progression/progression-lake-reads.ts";

export async function fetchChallengeEvidence(options: {
  readonly puuids: string[];
  readonly startAt: Date;
  readonly endAt?: Date;
  readonly cursor?: ProgressionMatchCursor;
  readonly limit?: number;
}): Promise<{
  readonly evidence: {
    readonly puuid: string;
    readonly match: ChallengeEvidenceMatch;
  }[];
  readonly rowsRead: number;
  readonly nextCursor: ProgressionMatchCursor | undefined;
}> {
  const rows = await fetchProgressionMatches(options);
  const timelineCounts = await fetchTimelineEventCounts({
    matchPuuids: rows.map((row) => ({
      matchId: row.match_id,
      puuid: row.puuid,
    })),
  });
  const evidence: {
    readonly puuid: string;
    readonly match: ChallengeEvidenceMatch;
  }[] = [];
  for (const row of rows) {
    if (
      row.end_of_game_result !== "GameComplete" ||
      row.early_surrendered ||
      row.game_duration_seconds < 300
    ) {
      continue;
    }
    evidence.push({
      puuid: row.puuid,
      match: ChallengeEvidenceMatchSchema.parse({
        matchId: row.match_id,
        gameEndAt: row.game_end_at,
        queue: row.queue,
        championId: row.champion_id,
        championName: row.champion_name,
        role: row.team_position.length === 0 ? "UNKNOWN" : row.team_position,
        win: row.win,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        creep_score: row.creep_score,
        gold_earned: row.gold_earned,
        vision_score: row.vision_score,
        champion_damage: row.total_damage_dealt_to_champions,
        damage_taken: row.total_damage_taken,
        damage_mitigated: row.damage_self_mitigated,
        teammate_healing: row.total_heals_on_teammates,
        wards_cleared: row.wards_killed,
        objective_damage: row.damage_dealt_to_objectives,
        turret_damage: row.damage_dealt_to_turrets,
        crowd_control_time: row.time_ccing_others,
        longest_life: row.longest_time_spent_living,
        total_time_dead: row.total_time_spent_dead,
        timelineEvidenceAvailable: row.timeline_complete,
        timelineEventCounts:
          timelineCounts.get(row.match_id)?.get(row.puuid) ?? {},
      }),
    });
  }
  const last = rows.at(-1);
  return {
    evidence,
    rowsRead: rows.length,
    nextCursor:
      last === undefined
        ? undefined
        : {
            gameEndMs: last.game_end_ms,
            matchId: last.match_id,
            puuid: last.puuid,
          },
  };
}
