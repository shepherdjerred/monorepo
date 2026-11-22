import type { Database } from "bun:sqlite";
import type {
  DailyActivityPoint,
  ServerOverviewKpis,
  ServerOverviewResponse,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  loadAllPlayerActivityScores,
  loadServerState,
  summarizePlayerbaseGroups,
  toSessionSummaries,
} from "./player-activity.ts";
import { buildModeShares, buildWorldShares } from "./queries-shares.ts";
import type { SessionRow } from "./schema.ts";
import {
  DAY_MS,
  addCalendarDays,
  buildCalendarDaySeries,
  msToHours,
  msToMinutes,
  toPacificDay,
} from "./time.ts";

type DayBucket = {
  connectedMs: number;
  activeMs: number;
  readonly players: Set<string>;
  readonly sessions: Set<string>;
};

function getOrCreateDayBucket(
  map: Map<string, DayBucket>,
  day: string,
): DayBucket {
  let bucket = map.get(day);
  if (bucket === undefined) {
    bucket = {
      connectedMs: 0,
      activeMs: 0,
      players: new Set<string>(),
      sessions: new Set<string>(),
    };
    map.set(day, bucket);
  }
  return bucket;
}

export function buildDailyActivitySeries(
  db: Database,
  endPacificDay: string,
  daysCount: number,
): DailyActivityPoint[] {
  const days = buildCalendarDaySeries(endPacificDay, daysCount);
  const startDay = days[0] ?? endPacificDay;

  const firstSeenRows = db
    .query<{ uuid: string; first_seen_at: string }, []>(
      "SELECT uuid, first_seen_at FROM players",
    )
    .all();
  const firstSeenDayByUuid = new Map<string, string>();
  const registeredByDay = new Map<string, string[]>();
  for (const row of firstSeenRows) {
    const day = toPacificDay(row.first_seen_at);
    firstSeenDayByUuid.set(row.uuid, day);
    if (day >= startDay && day <= endPacificDay) {
      const list = registeredByDay.get(day) ?? [];
      list.push(row.uuid);
      registeredByDay.set(day, list);
    }
  }

  const byDay = new Map<string, DayBucket>();

  const intervalRows = db
    .query<
      {
        pacific_day: string;
        player_uuid: string;
        session_id: string;
        connected_ms: number;
        active_ms: number;
      },
      [string, string]
    >(
      `SELECT pacific_day, player_uuid, session_id, connected_ms, active_ms
       FROM session_intervals
       WHERE pacific_day >= ? AND pacific_day <= ?`,
    )
    .all(startDay, endPacificDay);

  for (const row of intervalRows) {
    const bucket = getOrCreateDayBucket(byDay, row.pacific_day);
    bucket.connectedMs += row.connected_ms;
    bucket.activeMs += row.active_ms;
    bucket.players.add(row.player_uuid);
    bucket.sessions.add(row.session_id);
  }

  const remainderSessions = db
    .query<
      {
        session_id: string;
        player_uuid: string;
        ref_at: string;
        rem_connected: number;
        rem_active: number;
      },
      []
    >(
      `SELECT session_id,
              player_uuid,
              COALESCE(ended_at, started_at) AS ref_at,
              MAX(0, connected_ms - interval_connected_ms) AS rem_connected,
              MAX(0, active_ms - interval_active_ms) AS rem_active
       FROM sessions
       WHERE connected_ms > interval_connected_ms OR interval_connected_ms = 0`,
    )
    .all();

  for (const s of remainderSessions) {
    const day = toPacificDay(s.ref_at);
    if (day >= startDay && day <= endPacificDay) {
      const bucket = getOrCreateDayBucket(byDay, day);
      bucket.connectedMs += s.rem_connected;
      bucket.activeMs += s.rem_active;
      bucket.players.add(s.player_uuid);
      bucket.sessions.add(s.session_id);
    }
  }

  return days.map((day) => {
    const bucket = byDay.get(day);
    const players = new Set<string>(bucket?.players);
    for (const uuid of registeredByDay.get(day) ?? []) {
      players.add(uuid);
    }
    let newPlayers = 0;
    for (const uuid of players) {
      if (firstSeenDayByUuid.get(uuid) === day) {
        newPlayers += 1;
      }
    }
    const uniquePlayers = players.size;
    return {
      day,
      uniquePlayers,
      newPlayers,
      returningPlayers: Math.max(0, uniquePlayers - newPlayers),
      connectedHours: msToHours(bucket?.connectedMs ?? 0),
      activeHours: msToHours(bucket?.activeMs ?? 0),
      sessions: bucket?.sessions.size ?? 0,
    };
  });
}

function queryRollingWindowStats(
  db: Database,
  sinceIso: string,
  nowIso: string,
): {
  readonly uniquePlayers: number;
  readonly newPlayers: number;
  readonly connectedMs: number;
  readonly activeMs: number;
} {
  const uniqueRow = db
    .query<{ c: number }, [string, string, string, string]>(
      `SELECT COUNT(*) AS c FROM (
         SELECT player_uuid FROM session_intervals WHERE started_at >= ? AND started_at <= ?
         UNION
         SELECT player_uuid FROM sessions WHERE COALESCE(ended_at, started_at) >= ? AND started_at <= ?
       )`,
    )
    .get(sinceIso, nowIso, sinceIso, nowIso);

  const newRow = db
    .query<{ c: number }, [string, string]>(
      "SELECT COUNT(*) AS c FROM players WHERE first_seen_at >= ? AND first_seen_at <= ?",
    )
    .get(sinceIso, nowIso);

  const intervalSums = db
    .query<{ c_ms: number | null; a_ms: number | null }, [string, string]>(
      `SELECT SUM(connected_ms) AS c_ms, SUM(active_ms) AS a_ms
       FROM session_intervals WHERE started_at >= ? AND started_at <= ?`,
    )
    .get(sinceIso, nowIso);

  const remSums = db
    .query<{ c_ms: number | null; a_ms: number | null }, [string, string]>(
      `SELECT SUM(MAX(0, connected_ms - interval_connected_ms)) AS c_ms,
              SUM(MAX(0, active_ms - interval_active_ms)) AS a_ms
       FROM sessions
       WHERE COALESCE(ended_at, started_at) >= ? AND COALESCE(ended_at, started_at) <= ?`,
    )
    .get(sinceIso, nowIso);

  return {
    uniquePlayers: uniqueRow?.c ?? 0,
    newPlayers: newRow?.c ?? 0,
    connectedMs: (intervalSums?.c_ms ?? 0) + (remSums?.c_ms ?? 0),
    activeMs: (intervalSums?.a_ms ?? 0) + (remSums?.a_ms ?? 0),
  };
}

function buildOverviewKpis(
  db: Database,
  nowIso: string,
  todayPacific: string,
  peakAllTime: { readonly peak: number; readonly peakAt: string | null },
): ServerOverviewKpis {
  const nowMs = new Date(nowIso).getTime();
  const since24h = new Date(nowMs - DAY_MS).toISOString();
  const since7d = new Date(nowMs - 7 * DAY_MS).toISOString();
  const since30d = new Date(nowMs - 30 * DAY_MS).toISOString();

  const w24h = queryRollingWindowStats(db, since24h, nowIso);
  const w7d = queryRollingWindowStats(db, since7d, nowIso);
  const w30d = queryRollingWindowStats(db, since30d, nowIso);

  const totals = db
    .query<
      {
        players: number;
        connected_ms: number | null;
        active_ms: number | null;
      },
      []
    >(
      `SELECT COUNT(*) AS players, SUM(connected_ms) AS connected_ms, SUM(active_ms) AS active_ms
       FROM players`,
    )
    .get();

  const sessions30d = db
    .query<
      { completed: number; avg_c: number | null; avg_a: number | null },
      [string, string]
    >(
      `SELECT COUNT(*) AS completed, AVG(connected_ms) AS avg_c, AVG(active_ms) AS avg_a
       FROM sessions
       WHERE ongoing = 0
         AND COALESCE(ended_at, started_at) >= ?
         AND COALESCE(ended_at, started_at) <= ?`,
    )
    .get(since30d, nowIso);

  const start30dDay = addCalendarDays(todayPacific, -29);
  const peak30dRow = db
    .query<{ p: number | null }, [string, string]>(
      "SELECT MAX(peak_online) AS p FROM online_peaks WHERE pacific_day >= ? AND pacific_day <= ?",
    )
    .get(start30dDay, todayPacific);

  const peakOnline30d = peak30dRow?.p ?? 0;
  const peakOnlineAllTime = Math.max(peakAllTime.peak, peakOnline30d);

  return {
    uniquePlayers24h: w24h.uniquePlayers,
    uniquePlayers7d: w7d.uniquePlayers,
    uniquePlayers30d: w30d.uniquePlayers,
    totalPlayers: totals?.players ?? 0,
    newPlayers24h: w24h.newPlayers,
    newPlayers7d: w7d.newPlayers,
    newPlayers30d: w30d.newPlayers,
    connectedHours24h: msToHours(w24h.connectedMs),
    activeHours24h: msToHours(w24h.activeMs),
    connectedHours7d: msToHours(w7d.connectedMs),
    activeHours7d: msToHours(w7d.activeMs),
    connectedHours30d: msToHours(w30d.connectedMs),
    activeHours30d: msToHours(w30d.activeMs),
    totalConnectedHours: msToHours(totals?.connected_ms ?? 0),
    totalActiveHours: msToHours(totals?.active_ms ?? 0),
    completedSessions30d: sessions30d?.completed ?? 0,
    meanSessionMinutes30d: msToMinutes(sessions30d?.avg_c ?? 0),
    meanActiveMinutes30d: msToMinutes(sessions30d?.avg_a ?? 0),
    peakOnline30d,
    peakOnlineAllTime,
    peakOnlineAt: peakAllTime.peakAt,
  };
}

export function queryServerOverview(
  db: Database,
  nowIso: string,
): ServerOverviewResponse {
  const { row: state, onlinePlayers } = loadServerState(db);
  const todayPacific = toPacificDay(nowIso);
  const activityScores = loadAllPlayerActivityScores(db, nowIso);
  const playerbaseGroups = summarizePlayerbaseGroups(activityScores.values());

  const recentSessionRows = db
    .query<SessionRow, []>(
      `SELECT * FROM sessions
       ORDER BY ongoing DESC, COALESCE(ended_at, started_at) DESC, started_at DESC
       LIMIT 20`,
    )
    .all();

  return {
    serverName: state.server_name,
    generatedAt: nowIso,
    lastIngestAt: state.last_ingest_at,
    onlineNow: onlinePlayers.length,
    maxPlayers: state.max_players,
    onlinePlayers,
    kpis: buildOverviewKpis(db, nowIso, todayPacific, {
      peak: state.peak_online_all_time,
      peakAt: state.peak_online_at,
    }),
    dailyActivity30d: buildDailyActivitySeries(db, todayPacific, 30),
    playerbaseGroups,
    worldBreakdown: buildWorldShares(db),
    modeBreakdown: buildModeShares(db),
    recentSessions: toSessionSummaries(db, recentSessionRows),
  };
}
