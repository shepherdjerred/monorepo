import type { Database } from "bun:sqlite";
import type {
  IngestBatch,
  IngestBatchAck,
  IngestEvent,
  PlayerGameplaySnapshot,
  ServerSnapshot,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  applySessionEnded,
  applySessionInterval,
  applySessionStarted,
  ensurePlayerRow,
} from "./ingest-sessions.ts";
import type { ServerStateRow } from "./schema.ts";
import { toPacificDay } from "./time.ts";

function applyCombatKiller(
  db: Database,
  event: Extract<IngestEvent, { type: "combat_event" }>,
  touched: Set<string>,
): void {
  if (event.killerUuid === null) {
    return;
  }
  touched.add(event.killerUuid);
  ensurePlayerRow(db, {
    uuid: event.killerUuid,
    name: event.killerName ?? "Unknown",
    seenAt: event.occurredAt,
  });
  if (event.combatKind === "pvp") {
    db.query("UPDATE players SET pvp_kills = pvp_kills + 1 WHERE uuid = ?").run(
      event.killerUuid,
    );
    if (event.sessionId !== null) {
      db.query(
        "UPDATE sessions SET pvp_kills = pvp_kills + 1 WHERE session_id = ? AND player_uuid = ?",
      ).run(event.sessionId, event.killerUuid);
    }
  } else if (event.combatKind === "pve_kill") {
    db.query("UPDATE players SET mob_kills = mob_kills + 1 WHERE uuid = ?").run(
      event.killerUuid,
    );
    if (event.sessionId !== null) {
      db.query(
        "UPDATE sessions SET mob_kills = mob_kills + 1 WHERE session_id = ? AND player_uuid = ?",
      ).run(event.sessionId, event.killerUuid);
    }
  }
}

function applyCombatVictim(
  db: Database,
  event: Extract<IngestEvent, { type: "combat_event" }>,
  touched: Set<string>,
): void {
  if (event.victimUuid === null) {
    return;
  }
  touched.add(event.victimUuid);
  ensurePlayerRow(db, {
    uuid: event.victimUuid,
    name: event.victimName ?? "Unknown",
    seenAt: event.occurredAt,
  });

  switch (event.combatKind) {
    case "pvp":
      db.query(
        "UPDATE players SET pvp_deaths = pvp_deaths + 1 WHERE uuid = ?",
      ).run(event.victimUuid);
      break;
    case "pve_death":
      db.query(
        "UPDATE players SET mob_deaths = mob_deaths + 1 WHERE uuid = ?",
      ).run(event.victimUuid);
      break;
    case "env_death":
      db.query(
        "UPDATE players SET env_deaths = env_deaths + 1 WHERE uuid = ?",
      ).run(event.victimUuid);
      break;
    case "pve_kill":
      break;
  }

  if (event.sessionId !== null) {
    const updated = db
      .query(
        "UPDATE sessions SET deaths = deaths + 1 WHERE session_id = ? AND player_uuid = ?",
      )
      .run(event.sessionId, event.victimUuid);
    if (updated.changes > 0) {
      return;
    }
  }
  db.query(
    `UPDATE sessions SET deaths = deaths + 1
     WHERE session_id = (
       SELECT session_id FROM sessions
       WHERE player_uuid = ? AND ongoing = 1
       ORDER BY started_at DESC LIMIT 1
     )`,
  ).run(event.victimUuid);
}

function applyCombatEvent(
  db: Database,
  event: Extract<IngestEvent, { type: "combat_event" }>,
  touched: Set<string>,
): void {
  db.query(
    `INSERT INTO combat_events (
      event_id, occurred_at, session_id, combat_kind,
      killer_uuid, killer_name, victim_uuid, victim_name,
      mob_type, weapon, world
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.eventId,
    event.occurredAt,
    event.sessionId,
    event.combatKind,
    event.killerUuid,
    event.killerName,
    event.victimUuid,
    event.victimName,
    event.mobType,
    event.weapon,
    event.world,
  );
  applyCombatKiller(db, event, touched);
  applyCombatVictim(db, event, touched);
}

function applyConnectionBounce(
  db: Database,
  event: Extract<IngestEvent, { type: "connection_bounce" }>,
  touched: Set<string>,
): void {
  db.query(
    `INSERT INTO connection_bounces (
      event_id, occurred_at, player_uuid, player_name, category, reason, join_address
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.eventId,
    event.occurredAt,
    event.playerUuid,
    event.playerName,
    event.category,
    event.reason,
    event.joinAddress,
  );

  if (event.playerUuid !== null) {
    const updated = db
      .query(
        `UPDATE players
         SET bounces_count = bounces_count + 1,
             last_join_address = COALESCE(last_join_address, ?)
         WHERE uuid = ?`,
      )
      .run(event.joinAddress, event.playerUuid);
    if (updated.changes > 0) {
      touched.add(event.playerUuid);
    }
  }
}

function applyPlayerSnapshot(db: Database, snap: PlayerGameplaySnapshot): void {
  ensurePlayerRow(db, {
    uuid: snap.playerUuid,
    name: snap.playerName,
    seenAt: snap.capturedAt,
  });
  db.query(
    `UPDATE players
     SET nickname = ?,
         primary_group = ?
     WHERE uuid = ?`,
  ).run(snap.nickname, snap.primaryGroup, snap.playerUuid);

  const existing = db
    .query<{ captured_at: string }, [string]>(
      "SELECT captured_at FROM player_gameplay WHERE player_uuid = ?",
    )
    .get(snap.playerUuid);
  if (existing !== null && existing.captured_at > snap.capturedAt) {
    return;
  }

  db.query(
    `INSERT INTO player_gameplay (
      player_uuid, player_name, captured_at, coins,
      town_name, town_role, town_claims, power_level,
      top_skill, top_skill_level, skills_json, tracks_json,
      quests_completed, arena_waves_json,
      rwf_matches, rwf_wins, rwf_losses, rwf_kills, rwf_deaths
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_uuid) DO UPDATE SET
      player_name = excluded.player_name,
      captured_at = excluded.captured_at,
      coins = excluded.coins,
      town_name = excluded.town_name,
      town_role = excluded.town_role,
      town_claims = excluded.town_claims,
      power_level = excluded.power_level,
      top_skill = excluded.top_skill,
      top_skill_level = excluded.top_skill_level,
      skills_json = excluded.skills_json,
      tracks_json = excluded.tracks_json,
      quests_completed = excluded.quests_completed,
      arena_waves_json = excluded.arena_waves_json,
      rwf_matches = excluded.rwf_matches,
      rwf_wins = excluded.rwf_wins,
      rwf_losses = excluded.rwf_losses,
      rwf_kills = excluded.rwf_kills,
      rwf_deaths = excluded.rwf_deaths`,
  ).run(
    snap.playerUuid,
    snap.playerName,
    snap.capturedAt,
    snap.coins,
    snap.townName,
    snap.townRole,
    snap.townClaims,
    snap.powerLevel,
    snap.topSkill,
    snap.topSkillLevel,
    JSON.stringify(snap.skills),
    JSON.stringify(snap.tracks),
    snap.questsCompleted,
    JSON.stringify(snap.arenaBestWaves),
    snap.rwfMatches,
    snap.rwfWins,
    snap.rwfLosses,
    snap.rwfKills,
    snap.rwfDeaths,
  );
}

function applyServerSnapshot(db: Database, snap: ServerSnapshot): void {
  const onlineCount = snap.onlinePlayers.length;
  const pacificDay = toPacificDay(snap.capturedAt);

  db.query(
    `INSERT INTO online_peaks (pacific_day, peak_online)
     VALUES (?, ?)
     ON CONFLICT(pacific_day) DO UPDATE SET
       peak_online = MAX(online_peaks.peak_online, excluded.peak_online)`,
  ).run(pacificDay, onlineCount);

  const state = db
    .query<ServerStateRow, []>("SELECT * FROM server_state WHERE id = 1")
    .get();
  if (state === null) {
    return;
  }

  const isNewPeak =
    onlineCount > state.peak_online_all_time ||
    (onlineCount > 0 &&
      onlineCount === state.peak_online_all_time &&
      state.peak_online_at === null);
  const peakCount = isNewPeak ? onlineCount : state.peak_online_all_time;
  const peakAt = isNewPeak ? snap.capturedAt : state.peak_online_at;

  const shouldReplaceSnapshot =
    state.snapshot_captured_at === null ||
    state.snapshot_captured_at <= snap.capturedAt;

  db.query(
    `UPDATE server_state
     SET snapshot_captured_at = ?,
         max_players = ?,
         online_players_json = ?,
         towns_json = ?,
         peak_online_all_time = ?,
         peak_online_at = ?
     WHERE id = 1`,
  ).run(
    shouldReplaceSnapshot ? snap.capturedAt : state.snapshot_captured_at,
    shouldReplaceSnapshot ? snap.maxPlayers : state.max_players,
    shouldReplaceSnapshot
      ? JSON.stringify(snap.onlinePlayers)
      : state.online_players_json,
    shouldReplaceSnapshot ? JSON.stringify(snap.towns) : state.towns_json,
    peakCount,
    peakAt,
  );
}

export function ingestBatchInTransaction(
  db: Database,
  batch: IngestBatch,
): IngestBatchAck {
  const runTx = db.transaction((b: IngestBatch): IngestBatchAck => {
    db.query(
      `UPDATE server_state
       SET server_name = ?,
           last_ingest_at = CASE
             WHEN last_ingest_at IS NULL OR last_ingest_at < ? THEN ?
             ELSE last_ingest_at
           END
       WHERE id = 1`,
    ).run(b.serverName, b.sentAt, b.sentAt);

    let acceptedEvents = 0;
    let duplicateEvents = 0;
    const touchedPlayers = new Set<string>();

    const insertProcessed = db.query(
      "INSERT OR IGNORE INTO processed_events (event_id, event_type, occurred_at) VALUES (?, ?, ?)",
    );

    for (const event of b.events) {
      const inserted = insertProcessed.run(
        event.eventId,
        event.type,
        event.occurredAt,
      );
      if (inserted.changes === 0) {
        duplicateEvents += 1;
        continue;
      }
      acceptedEvents += 1;
      switch (event.type) {
        case "session_started":
          touchedPlayers.add(event.playerUuid);
          applySessionStarted(db, event);
          break;
        case "session_interval":
          touchedPlayers.add(event.playerUuid);
          applySessionInterval(db, event);
          break;
        case "session_ended":
          touchedPlayers.add(event.playerUuid);
          applySessionEnded(db, event);
          break;
        case "combat_event":
          applyCombatEvent(db, event, touchedPlayers);
          break;
        case "connection_bounce":
          applyConnectionBounce(db, event, touchedPlayers);
          break;
      }
    }

    for (const snap of b.playerSnapshots) {
      touchedPlayers.add(snap.playerUuid);
      applyPlayerSnapshot(db, snap);
    }

    if (b.serverSnapshot !== null) {
      applyServerSnapshot(db, b.serverSnapshot);
    }

    return {
      acceptedEvents,
      duplicateEvents,
      updatedPlayers: touchedPlayers.size,
    };
  });

  return runTx(batch);
}
