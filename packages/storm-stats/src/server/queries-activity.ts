import type { Database } from "bun:sqlite";
import type {
  FirstSessionEngagement,
  OnlineActivityResponse,
  PunchcardCell,
  RetentionCohortRow,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  loadAllPlayerActivityScores,
  summarizePlayerbaseGroups,
} from "./player-activity.ts";
import { buildDailyActivitySeries } from "./queries-overview.ts";
import {
  MINUTE_MS,
  PACIFIC_TIME_ZONE,
  addCalendarDays,
  mondayOfCalendarDay,
  msToHours,
  msToMinutes,
  safePercent,
  toPacificDay,
} from "./time.ts";

function buildPunchcard(db: Database): PunchcardCell[] {
  const rows = db
    .query<
      {
        pacific_dow: number;
        pacific_hour: number;
        active_ms: number;
        players: number;
        sessions: number;
      },
      []
    >(
      `SELECT pacific_dow,
              pacific_hour,
              SUM(active_ms) AS active_ms,
              COUNT(DISTINCT player_uuid) AS players,
              COUNT(DISTINCT session_id) AS sessions
       FROM session_intervals
       GROUP BY pacific_dow, pacific_hour`,
    )
    .all();

  const byKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    byKey.set(`${String(row.pacific_dow)}:${String(row.pacific_hour)}`, row);
  }

  const cells: PunchcardCell[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const found = byKey.get(`${String(dayOfWeek)}:${String(hour)}`);
      cells.push({
        dayOfWeek,
        hour,
        activeHours: msToHours(found?.active_ms ?? 0),
        uniquePlayers: found?.players ?? 0,
        sessions: found?.sessions ?? 0,
      });
    }
  }
  return cells;
}

function hasAnyDayInWindow(
  days: ReadonlySet<string> | undefined,
  startDay: string,
  endDay: string,
): boolean {
  if (days === undefined) {
    return false;
  }
  for (const d of days) {
    if (d >= startDay && d <= endDay) {
      return true;
    }
  }
  return false;
}

function addPlayerActiveDay(
  map: Map<string, Set<string>>,
  playerUuid: string,
  day: string,
): void {
  let set = map.get(playerUuid);
  if (set === undefined) {
    set = new Set<string>();
    map.set(playerUuid, set);
  }
  set.add(day);
}

function buildRetentionCohorts(
  db: Database,
  todayPacific: string,
): RetentionCohortRow[] {
  const currentMonday = mondayOfCalendarDay(todayPacific);
  const cohortWeeks: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    cohortWeeks.push(addCalendarDays(currentMonday, -i * 7));
  }
  const earliestCohort = cohortWeeks[0] ?? currentMonday;

  const players = db
    .query<{ uuid: string; first_seen_at: string }, []>(
      "SELECT uuid, first_seen_at FROM players",
    )
    .all();

  const cohortMembers = new Map<string, string[]>();
  for (const w of cohortWeeks) {
    cohortMembers.set(w, []);
  }
  for (const p of players) {
    const monday = mondayOfCalendarDay(toPacificDay(p.first_seen_at));
    cohortMembers.get(monday)?.push(p.uuid);
  }

  const activeDaysByPlayer = new Map<string, Set<string>>();
  const intervalDays = db
    .query<{ player_uuid: string; pacific_day: string }, [string]>(
      `SELECT DISTINCT player_uuid, pacific_day
       FROM session_intervals WHERE pacific_day >= ?`,
    )
    .all(earliestCohort);
  for (const row of intervalDays) {
    addPlayerActiveDay(activeDaysByPlayer, row.player_uuid, row.pacific_day);
  }

  const sessionDays = db
    .query<{ player_uuid: string; started_at: string }, []>(
      "SELECT player_uuid, started_at FROM sessions",
    )
    .all();
  for (const row of sessionDays) {
    const day = toPacificDay(row.started_at);
    if (day >= earliestCohort) {
      addPlayerActiveDay(activeDaysByPlayer, row.player_uuid, day);
    }
  }

  return cohortWeeks.map((cohortWeek) => {
    const members = cohortMembers.get(cohortWeek) ?? [];
    const w1Start = addCalendarDays(cohortWeek, 7);
    const w1End = addCalendarDays(cohortWeek, 13);
    const w2Start = addCalendarDays(cohortWeek, 14);
    const w2End = addCalendarDays(cohortWeek, 20);
    const w4Start = addCalendarDays(cohortWeek, 28);
    const w4End = addCalendarDays(cohortWeek, 34);

    let week1Retained = 0;
    let week2Retained = 0;
    let week4Retained = 0;
    for (const uuid of members) {
      const seen = activeDaysByPlayer.get(uuid);
      if (hasAnyDayInWindow(seen, w1Start, w1End)) {
        week1Retained += 1;
      }
      if (hasAnyDayInWindow(seen, w2Start, w2End)) {
        week2Retained += 1;
      }
      if (hasAnyDayInWindow(seen, w4Start, w4End)) {
        week4Retained += 1;
      }
    }
    const newPlayers = members.length;
    return {
      cohortWeek,
      newPlayers,
      week1Retained,
      week2Retained,
      week4Retained,
      week1Percent: safePercent(week1Retained, newPlayers),
      week2Percent: safePercent(week2Retained, newPlayers),
      week4Percent: safePercent(week4Retained, newPlayers),
    };
  });
}

function buildFirstSessionEngagement(db: Database): FirstSessionEngagement {
  const firstSessions = db
    .query<{ active_ms: number; ongoing: number }, []>(
      `SELECT active_ms, ongoing
       FROM (
         SELECT active_ms,
                ongoing,
                ROW_NUMBER() OVER (
                  PARTITION BY player_uuid
                  ORDER BY started_at ASC, session_id ASC
                ) AS rn
         FROM sessions
       )
       WHERE rn = 1 AND ongoing = 0`,
    )
    .all();

  const completedFirstSessions = firstSessions.length;
  if (completedFirstSessions === 0) {
    return {
      completedFirstSessions: 0,
      meanActiveMinutes: 0,
      reachedTenActiveMinutes: 0,
      tenMinutePercent: 0,
    };
  }
  let sumActiveMs = 0;
  let reachedTen = 0;
  const tenMinutesMs = 10 * MINUTE_MS;
  for (const row of firstSessions) {
    sumActiveMs += row.active_ms;
    if (row.active_ms >= tenMinutesMs) {
      reachedTen += 1;
    }
  }
  return {
    completedFirstSessions,
    meanActiveMinutes: msToMinutes(sumActiveMs / completedFirstSessions),
    reachedTenActiveMinutes: reachedTen,
    tenMinutePercent: safePercent(reachedTen, completedFirstSessions),
  };
}

export function queryOnlineActivity(
  db: Database,
  nowIso: string,
): OnlineActivityResponse {
  const todayPacific = toPacificDay(nowIso);
  const activityScores = loadAllPlayerActivityScores(db, nowIso);

  return {
    generatedAt: nowIso,
    timeZone: PACIFIC_TIME_ZONE,
    dailySeries180d: buildDailyActivitySeries(db, todayPacific, 180),
    punchcard: buildPunchcard(db),
    calendar730d: buildDailyActivitySeries(db, todayPacific, 730),
    playerbaseGroups: summarizePlayerbaseGroups(activityScores.values()),
    retentionCohorts: buildRetentionCohorts(db, todayPacific),
    firstSessionEngagement: buildFirstSessionEngagement(db),
  };
}
