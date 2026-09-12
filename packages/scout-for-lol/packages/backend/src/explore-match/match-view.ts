import {
  ExploreMatchCardSchema,
  ExploreMatchSnapshotSchema,
  isArenaQueueOrMode,
  isClassicAssetMode,
  MatchIdSchema,
  type ExploreMatchCard,
  type ExploreMatchCardRequest,
  type ExploreMatchSnapshot,
  type MatchTeamLakeRow,
  type ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import type { ScoutQlSource } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import {
  fetchFullMatch,
  fetchFullMatchTeams,
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

type ExploreMatchSupportLookup = (
  matchId: string,
) => Promise<
  readonly Pick<LakeMatchParticipantRow, "queue_id" | "game_mode">[]
>;

function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

/** Arena and Classic modes need scoreboards this neutral snapshot cannot render. */
export function isExploreMatchSnapshotSupported(
  queueId: number,
  gameMode: string,
): boolean {
  return (
    !isArenaQueueOrMode(queueId, gameMode) &&
    !isClassicAssetMode(queueId, gameMode)
  );
}

export function normalizeRiotIdPart(value: string | null): string | null {
  return value === "" ? null : value;
}

/** Convert the lake's normalized participant rows into a neutral match view. */
export function exploreMatchSnapshot(
  rows: LakeMatchParticipantRow[],
  matchTeams: MatchTeamLakeRow[],
): ExploreMatchSnapshot {
  const first = requiredFirst(rows);
  if (rows.some((row) => row.match_id !== first.match_id)) {
    throw new Error("Explore match detail rows contain more than one match");
  }
  if (!isExploreMatchSnapshotSupported(first.queue_id, first.game_mode)) {
    throw new Error(
      "This match mode does not support the Explore match snapshot",
    );
  }
  const grouped = Map.groupBy(rows, (row) => row.team_id);
  const teams = [...grouped.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([teamId, teamParticipants]) => {
      const team = matchTeams.find((row) => row.team_id === teamId);
      if (team === undefined)
        throw new Error("Explore match is missing a team row");
      const teamFirst = requiredFirst(teamParticipants);
      const kills = teamParticipants.reduce(
        (total, row) => total + row.kills,
        0,
      );
      const damage = teamParticipants.reduce(
        (total, row) => total + row.total_damage_dealt_to_champions,
        0,
      );
      return {
        teamId,
        win: teamFirst.win,
        kills,
        objectives: {
          turrets: team.tower_kills,
          inhibitors: team.inhibitor_kills,
          barons: team.baron_kills,
          dragons: team.dragon_kills,
        },
        participants: teamParticipants.map((row) => ({
          participantId: row.participant_id,
          riotId: {
            gameName: normalizeRiotIdPart(row.riot_id_game_name),
            tagLine: normalizeRiotIdPart(row.riot_id_tagline),
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

/**
 * Card selection happens in the model, so establish the supported ids before
 * its final answer is generated. An unsupported id is never silently removed
 * from an otherwise-successful answer.
 */
export async function supportedExploreMatchIds(input: {
  matchIds: Set<string>;
  lookup?: ExploreMatchSupportLookup;
}): Promise<Set<string>> {
  const lookup =
    input.lookup ??
    (async (matchId: string) => await fetchFullMatch({ matchId }));
  const supported = await Promise.all(
    [...input.matchIds].map(async (matchId) => {
      const rows = await lookup(matchId);
      const first = rows[0];
      if (first === undefined) {
        throw new Error("A queried Explore match has no match participants");
      }
      return isExploreMatchSnapshotSupported(first.queue_id, first.game_mode)
        ? matchId
        : null;
    }),
  );
  return new Set(supported.filter((matchId) => matchId !== null));
}

export async function hydrateExploreMatchCards(input: {
  requests: ExploreMatchCardRequest[];
  eligibleMatchIds: Set<string>;
}): Promise<ExploreMatchCard[]> {
  assertEligibleExploreMatchCardRequests(input);
  return await Promise.all(
    input.requests.map(async (request) => {
      const [rows, teamRows] = await Promise.all([
        fetchFullMatch({ matchId: request.matchId }),
        fetchFullMatchTeams({ matchId: request.matchId }),
      ]);
      return ExploreMatchCardSchema.parse({
        size: request.size,
        match: exploreMatchSnapshot(rows, teamRows),
      });
    }),
  );
}

/** Reject an invalid model selection instead of silently losing its card. */
export function assertEligibleExploreMatchCardRequests(input: {
  requests: ExploreMatchCardRequest[];
  eligibleMatchIds: Set<string>;
}): void {
  for (const request of input.requests) {
    if (!input.eligibleMatchIds.has(request.matchId)) {
      throw new Error(
        `Explore match card ${request.matchId} was not returned as card-supported by the latest query`,
      );
    }
  }
}
