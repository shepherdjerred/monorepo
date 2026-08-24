import { addWeeks, formatISO, parseISO } from "date-fns";
import { z } from "zod";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  WEEKLY_PARLAY_HISTORY_WINDOW_COUNT,
  WEEKLY_PARLAY_MIN_HISTORY_WINDOWS,
  WeeklyParlayContributionSnapshotSchema,
  WeeklyParlaySubjectSchema,
  type WeeklyParlayContributionSnapshot,
  type WeeklyParlaySubject,
} from "#src/betting/weekly-parlay-criteria.ts";
import { weeklyParlayPeriod } from "#src/betting/weekly-parlay-period.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import type { WeeklyParlayReplayWindow } from "#src/betting/weekly-parlay-pricing.ts";

const LakeNumberSchema = z.union([z.number(), z.bigint()]).transform(Number);
const WeeklyHistoryRowSchema = z.object({
  match_id: z.string(),
  puuid: z.string(),
  completed_at_ms: LakeNumberSchema,
  queue: z.enum(["solo", "flex", "ranked 5s"]),
  win: z.boolean(),
  champion_name: z.string(),
  team_position: z.enum(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]),
  kills: LakeNumberSchema,
  deaths: LakeNumberSchema,
  assists: LakeNumberSchema,
  champion_damage: LakeNumberSchema,
  creep_score: LakeNumberSchema,
  gold: LakeNumberSchema,
  vision_score: LakeNumberSchema,
  time_played: LakeNumberSchema,
});

export type WeeklyParlayCandidateHistory = {
  subject: WeeklyParlaySubject;
  windows: WeeklyParlayReplayWindow[];
  fullyObservedWindows: number;
  recentEligibleGames: number;
  observedChampions: Set<string>;
  observedRoles: Set<string>;
};

function periodKeysBefore(periodKey: string): string[] {
  const current = parseISO(periodKey);
  return Array.from(
    { length: WEEKLY_PARLAY_HISTORY_WINDOW_COUNT },
    (_, index) =>
      formatISO(addWeeks(current, index - WEEKLY_PARLAY_HISTORY_WINDOW_COUNT), {
        representation: "date",
      }),
  );
}

function snapshotFor(
  row: z.infer<typeof WeeklyHistoryRowSchema>,
  subject: WeeklyParlaySubject,
): WeeklyParlayContributionSnapshot {
  return WeeklyParlayContributionSnapshotSchema.parse({
    subject: subject.key,
    puuid: row.puuid,
    queue: row.queue,
    completedAt: new Date(row.completed_at_ms).toISOString(),
    win: row.win,
    champion: row.champion_name,
    role: row.team_position,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    championDamage: row.champion_damage,
    creepScore: row.creep_score,
    gold: row.gold,
    visionScore: row.vision_score,
    timePlayed: row.time_played,
  });
}

export async function fetchWeeklyCandidateHistories(input: {
  periodKey: string;
  subjects: readonly WeeklyParlaySubject[];
  lakeDir?: string;
  abortSignal?: AbortSignal;
}): Promise<WeeklyParlayCandidateHistory[]> {
  if (input.subjects.length === 0) {
    return [];
  }
  const keys = periodKeysBefore(input.periodKey);
  const firstPeriod = weeklyParlayPeriod(keys[0] ?? "");
  const lastPeriod = weeklyParlayPeriod(keys.at(-1) ?? "");
  const puuids = input.subjects.flatMap((subject) =>
    subject.accounts.map((account) => account.puuid),
  );
  const files = await resolveLakeFiles(input.lakeDir ?? resolveLakeDir());
  const source = buildMatchesSource(files, {
    sql:
      "queue IN (SELECT unnest(?)) " +
      "AND epoch_ms(game_end_at) >= ? AND epoch_ms(game_end_at) < ?",
    params: [
      listParam(["solo", "flex", "ranked 5s"]),
      scalarParam(firstPeriod.scoringStartsAt.getTime()),
      scalarParam(lastPeriod.scoringEndsAt.getTime()),
    ],
  });
  if (source === undefined) {
    return [];
  }
  const rows = await withDuckDBConnection(
    async (session) => {
      const result = await session.run(
        "WITH scoring_rows AS (" +
          source.sql +
          "), eligible_matches AS (" +
          "SELECT match_id FROM scoring_rows GROUP BY match_id HAVING count(*) = 10 " +
          "AND count_if(team_id = 100) = 5 AND count_if(team_id = 200) = 5 " +
          "AND bool_and(end_of_game_result = 'GameComplete') " +
          "AND min(game_duration_seconds) >= 300 AND NOT bool_or(early_surrendered) " +
          "AND count_if(win) = 5 " +
          "AND count(DISTINCT CASE WHEN win THEN team_id END) = 1) " +
          "SELECT match_id, puuid, epoch_ms(game_end_at)::BIGINT AS completed_at_ms, " +
          "queue, win, champion_name, team_position, kills, deaths, assists, " +
          "total_damage_dealt_to_champions AS champion_damage, creep_score, " +
          "gold_earned AS gold, vision_score, time_played FROM scoring_rows " +
          "INNER JOIN eligible_matches USING (match_id) " +
          "WHERE puuid IN (SELECT unnest(?)) AND team_position <> '' " +
          "ORDER BY completed_at_ms ASC, match_id ASC",
        bindParams(session, [...source.params, listParam(puuids)]),
      );
      return result.map((row) => WeeklyHistoryRowSchema.parse(row));
    },
    {
      ...(input.abortSignal === undefined
        ? {}
        : { abortSignal: input.abortSignal }),
    },
  );
  const subjectByPuuid = new Map(
    input.subjects.flatMap((subject) =>
      subject.accounts.map((account) => [account.puuid, subject]),
    ),
  );
  const historyRowsByPlayer = new Map<
    number,
    { matchId: string; snapshot: WeeklyParlayContributionSnapshot }[]
  >();
  for (const row of rows) {
    const subject = subjectByPuuid.get(LeaguePuuidSchema.parse(row.puuid));
    if (subject === undefined) {
      continue;
    }
    const bucket = historyRowsByPlayer.get(subject.playerId) ?? [];
    bucket.push({ matchId: row.match_id, snapshot: snapshotFor(row, subject) });
    historyRowsByPlayer.set(subject.playerId, bucket);
  }
  return input.subjects
    .map((subject) => {
      const trackingStartedAt = Math.max(
        ...subject.accounts.map((account) =>
          new Date(account.trackingStartedAt).getTime(),
        ),
      );
      const historyRows = historyRowsByPlayer.get(subject.playerId) ?? [];
      const snapshots = historyRows.map((row) => row.snapshot);
      const windows = keys
        .map((key) => {
          const period = weeklyParlayPeriod(key);
          return {
            periodKey: key,
            observed: period.scoringStartsAt.getTime() >= trackingStartedAt,
            contributions: snapshots.filter((snapshot) => {
              const completedAt = new Date(snapshot.completedAt);
              return (
                completedAt >= period.scoringStartsAt &&
                completedAt < period.scoringEndsAt
              );
            }),
          };
        })
        .filter((window) => window.observed)
        .map((window) => ({
          periodKey: window.periodKey,
          contributions: window.contributions,
        }));
      const recentPeriod = weeklyParlayPeriod(keys.at(-1) ?? "");
      const recentMatchIds = new Set(
        historyRows
          .filter((row) => {
            const completedAt = new Date(row.snapshot.completedAt);
            return (
              completedAt >= recentPeriod.scoringStartsAt &&
              completedAt < recentPeriod.scoringEndsAt
            );
          })
          .map((row) => row.matchId),
      );
      return {
        subject: WeeklyParlaySubjectSchema.parse(subject),
        windows,
        fullyObservedWindows: windows.length,
        recentEligibleGames: recentMatchIds.size,
        observedChampions: new Set(
          snapshots.map((snapshot) => snapshot.champion),
        ),
        observedRoles: new Set(snapshots.map((snapshot) => snapshot.role)),
      };
    })
    .filter(
      (history) =>
        history.fullyObservedWindows >= WEEKLY_PARLAY_MIN_HISTORY_WINDOWS,
    );
}
