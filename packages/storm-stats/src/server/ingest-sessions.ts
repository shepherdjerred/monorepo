import type { Database } from "bun:sqlite";
import {
  normalizeIsoTimestamp,
  type IngestEvent,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import { toPacificParts } from "./time.ts";

export type MinimalPlayerInput = {
  readonly uuid: string;
  readonly name: string;
  readonly seenAt: string;
  readonly firstSeenAt?: string;
};

function parseIsoMillis(value: string): number {
  return Date.parse(normalizeIsoTimestamp(value));
}

function minIso(left: string, right: string): string {
  return new Date(
    Math.min(parseIsoMillis(left), parseIsoMillis(right)),
  ).toISOString();
}

function maxIso(left: string, right: string): string {
  return new Date(
    Math.max(parseIsoMillis(left), parseIsoMillis(right)),
  ).toISOString();
}

export function ensurePlayerRow(db: Database, input: MinimalPlayerInput): void {
  const existing = db
    .query<{ first_seen_at: string; last_seen_at: string }, [string]>(
      "SELECT first_seen_at, last_seen_at FROM players WHERE uuid = ?",
    )
    .get(input.uuid);

  const seenAt = normalizeIsoTimestamp(input.seenAt);
  const candidateFirst =
    input.firstSeenAt === undefined
      ? seenAt
      : minIso(input.firstSeenAt, seenAt);

  if (existing === null) {
    const priorBounces =
      db
        .query<{ c: number }, [string]>(
          "SELECT COUNT(*) AS c FROM connection_bounces WHERE player_uuid = ?",
        )
        .get(input.uuid)?.c ?? 0;
    db.query(
      `INSERT INTO players (
        uuid, name, name_lower, first_seen_at, last_seen_at, bounces_count
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.uuid,
      input.name,
      input.name.toLowerCase(),
      candidateFirst,
      seenAt,
      priorBounces,
    );
    return;
  }

  db.query(
    `UPDATE players
     SET name = ?,
         name_lower = ?,
         first_seen_at = ?,
         last_seen_at = ?
     WHERE uuid = ?`,
  ).run(
    input.name,
    input.name.toLowerCase(),
    minIso(existing.first_seen_at, candidateFirst),
    maxIso(existing.last_seen_at, seenAt),
    input.uuid,
  );
}

function ensureSessionRow(
  db: Database,
  input: {
    readonly sessionId: string;
    readonly playerUuid: string;
    readonly playerName: string;
    readonly startedAt: string;
  },
): void {
  const found = db
    .query<{ session_id: string }, [string]>(
      "SELECT session_id FROM sessions WHERE session_id = ?",
    )
    .get(input.sessionId);
  if (found !== null) {
    return;
  }
  const startedAt = normalizeIsoTimestamp(input.startedAt);
  db.query(
    `INSERT INTO sessions (
      session_id, player_uuid, player_name, started_at, ongoing
    ) VALUES (?, ?, ?, ?, 1)`,
  ).run(input.sessionId, input.playerUuid, input.playerName, startedAt);
  db.query(
    "UPDATE players SET sessions_count = sessions_count + 1 WHERE uuid = ?",
  ).run(input.playerUuid);
}

function reconcileSessionPlaytime(db: Database, sessionId: string): void {
  const row = db
    .query<
      {
        player_uuid: string;
        connected_ms: number;
        active_ms: number;
        interval_connected_ms: number;
        interval_active_ms: number;
        ended_connected_ms: number | null;
        ended_active_ms: number | null;
      },
      [string]
    >(
      `SELECT player_uuid, connected_ms, active_ms,
              interval_connected_ms, interval_active_ms,
              ended_connected_ms, ended_active_ms
       FROM sessions WHERE session_id = ?`,
    )
    .get(sessionId);
  if (row === null) {
    return;
  }
  const nextConnected = Math.max(
    row.interval_connected_ms,
    row.ended_connected_ms ?? 0,
  );
  const nextActive = Math.min(
    nextConnected,
    Math.max(row.interval_active_ms, row.ended_active_ms ?? 0),
  );
  const deltaConnected = nextConnected - row.connected_ms;
  const deltaActive = nextActive - row.active_ms;

  db.query(
    "UPDATE sessions SET connected_ms = ?, active_ms = ? WHERE session_id = ?",
  ).run(nextConnected, nextActive, sessionId);

  db.query(
    `UPDATE players
     SET connected_ms = MAX(0, connected_ms + ?),
         active_ms = MAX(0, active_ms + ?),
         longest_session_ms = MAX(longest_session_ms, ?)
     WHERE uuid = ?`,
  ).run(deltaConnected, deltaActive, nextConnected, row.player_uuid);
}

function recordPlayerPingSample(
  db: Database,
  playerUuid: string,
  pingMin: number,
  options: { readonly pingSample: number; readonly pingMax: number },
): void {
  db.query(
    `UPDATE players
     SET ping_min_ms = CASE WHEN ping_min_ms IS NULL THEN ? ELSE MIN(ping_min_ms, ?) END,
         ping_max_ms = CASE WHEN ping_max_ms IS NULL THEN ? ELSE MAX(ping_max_ms, ?) END,
         ping_sum_ms = ping_sum_ms + ?,
         ping_count = ping_count + 1
     WHERE uuid = ?`,
  ).run(
    pingMin,
    pingMin,
    options.pingMax,
    options.pingMax,
    options.pingSample,
    playerUuid,
  );
}

export function applySessionStarted(
  db: Database,
  event: Extract<IngestEvent, { type: "session_started" }>,
): void {
  ensurePlayerRow(db, {
    uuid: event.playerUuid,
    name: event.playerName,
    seenAt: event.occurredAt,
    firstSeenAt: event.firstSeenAt,
  });
  db.query(
    `UPDATE players
     SET platform = ?,
         client_version = ?,
         last_country_code = COALESCE(?, last_country_code),
         last_country_name = COALESCE(?, last_country_name),
         last_join_address = COALESCE(?, last_join_address)
     WHERE uuid = ?`,
  ).run(
    event.platform,
    event.clientVersion,
    event.countryCode,
    event.countryName,
    event.joinAddress,
    event.playerUuid,
  );
  ensureSessionRow(db, {
    sessionId: event.sessionId,
    playerUuid: event.playerUuid,
    playerName: event.playerName,
    startedAt: event.occurredAt,
  });
  db.query(
    `UPDATE sessions
     SET player_name = ?,
         started_at = MIN(started_at, ?),
         platform = ?,
         client_version = ?,
         client_brand = COALESCE(?, client_brand),
         join_address = COALESCE(?, join_address),
         country_code = COALESCE(?, country_code),
         country_name = COALESCE(?, country_name)
     WHERE session_id = ?`,
  ).run(
    event.playerName,
    event.occurredAt,
    event.platform,
    event.clientVersion,
    event.clientBrand,
    event.joinAddress,
    event.countryCode,
    event.countryName,
    event.sessionId,
  );
}

export function applySessionInterval(
  db: Database,
  event: Extract<IngestEvent, { type: "session_interval" }>,
): void {
  ensurePlayerRow(db, {
    uuid: event.playerUuid,
    name: event.playerName,
    seenAt: maxIso(event.occurredAt, event.intervalEnd),
  });
  ensureSessionRow(db, {
    sessionId: event.sessionId,
    playerUuid: event.playerUuid,
    playerName: event.playerName,
    startedAt: event.occurredAt,
  });

  const pacific = toPacificParts(event.occurredAt);
  const clampedActive = Math.min(event.activeMs, event.connectedMs);

  db.query(
    `INSERT INTO session_intervals (
      event_id, session_id, player_uuid, started_at, ended_at,
      pacific_day, pacific_dow, pacific_hour, world, mode,
      connected_ms, active_ms, ping_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.eventId,
    event.sessionId,
    event.playerUuid,
    event.occurredAt,
    event.intervalEnd,
    pacific.day,
    pacific.dayOfWeek,
    pacific.hour,
    event.world,
    event.mode,
    event.connectedMs,
    clampedActive,
    event.pingMs,
  );

  db.query(
    `UPDATE sessions
     SET player_name = ?,
         interval_connected_ms = interval_connected_ms + ?,
         interval_active_ms = interval_active_ms + ?
     WHERE session_id = ?`,
  ).run(event.playerName, event.connectedMs, clampedActive, event.sessionId);

  if (event.pingMs !== null) {
    db.query(
      `UPDATE sessions
       SET interval_ping_sum_ms = interval_ping_sum_ms + ?,
           interval_ping_count = interval_ping_count + 1,
           ping_min_ms = CASE WHEN ping_min_ms IS NULL THEN ? ELSE MIN(ping_min_ms, ?) END,
           ping_max_ms = CASE WHEN ping_max_ms IS NULL THEN ? ELSE MAX(ping_max_ms, ?) END,
           ping_avg_ms = CAST(ROUND(CAST(interval_ping_sum_ms + ? AS REAL) / (interval_ping_count + 1)) AS INTEGER)
       WHERE session_id = ?`,
    ).run(
      event.pingMs,
      event.pingMs,
      event.pingMs,
      event.pingMs,
      event.pingMs,
      event.pingMs,
      event.sessionId,
    );
    recordPlayerPingSample(db, event.playerUuid, event.pingMs, {
      pingSample: event.pingMs,
      pingMax: event.pingMs,
    });
  }

  reconcileSessionPlaytime(db, event.sessionId);
}

export function applySessionEnded(
  db: Database,
  event: Extract<IngestEvent, { type: "session_ended" }>,
): void {
  ensurePlayerRow(db, {
    uuid: event.playerUuid,
    name: event.playerName,
    seenAt: event.occurredAt,
    firstSeenAt: event.startedAt,
  });
  ensureSessionRow(db, {
    sessionId: event.sessionId,
    playerUuid: event.playerUuid,
    playerName: event.playerName,
    startedAt: event.startedAt,
  });

  const existing = db
    .query<{ interval_ping_count: number }, [string]>(
      "SELECT interval_ping_count FROM sessions WHERE session_id = ?",
    )
    .get(event.sessionId);

  const clampedActive = Math.min(event.activeMs, event.connectedMs);
  db.query(
    `UPDATE sessions
     SET player_name = ?,
         started_at = MIN(started_at, ?),
         ended_at = ?,
         ongoing = 0,
         ended_connected_ms = ?,
         ended_active_ms = ?,
         end_reason = ?,
         ping_min_ms = COALESCE(?, ping_min_ms),
         ping_avg_ms = COALESCE(?, ping_avg_ms),
         ping_max_ms = COALESCE(?, ping_max_ms)
     WHERE session_id = ?`,
  ).run(
    event.playerName,
    event.startedAt,
    event.occurredAt,
    event.connectedMs,
    clampedActive,
    event.endReason,
    event.pingMinMs,
    event.pingAvgMs,
    event.pingMaxMs,
    event.sessionId,
  );

  if ((existing?.interval_ping_count ?? 0) === 0 && event.pingAvgMs !== null) {
    recordPlayerPingSample(
      db,
      event.playerUuid,
      event.pingMinMs ?? event.pingAvgMs,
      {
        pingSample: event.pingAvgMs,
        pingMax: event.pingMaxMs ?? event.pingAvgMs,
      },
    );
  }

  reconcileSessionPlaytime(db, event.sessionId);
}
