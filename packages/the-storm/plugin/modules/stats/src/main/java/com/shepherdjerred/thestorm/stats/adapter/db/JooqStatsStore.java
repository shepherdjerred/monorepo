package com.shepherdjerred.thestorm.stats.adapter.db;

import static com.shepherdjerred.thestorm.stats.adapter.db.generated.Tables.STATS_OPEN_SESSION;
import static com.shepherdjerred.thestorm.stats.adapter.db.generated.Tables.STATS_OUTBOX;
import static com.shepherdjerred.thestorm.stats.adapter.db.generated.Tables.STATS_PLAYER;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.stats.app.PlayerStatsSummary;
import com.shepherdjerred.thestorm.stats.app.StatsStore;
import com.shepherdjerred.thestorm.stats.app.StatsWire;
import com.shepherdjerred.thestorm.stats.app.StatsWrite;
import com.shepherdjerred.thestorm.stats.domain.EndReason;
import com.shepherdjerred.thestorm.stats.domain.SessionLedger;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import tools.jackson.databind.json.JsonMapper;

/** jOOQ SQLite implementation of {@link StatsStore} with bounded outbox retention. */
public final class JooqStatsStore implements StatsStore {

  public static final int DEFAULT_MAX_OUTBOX_EVENTS = 5_000;
  private static final JsonMapper JSON = JsonMapper.builder().build();

  private final StormDatabase database;
  private final int maxOutboxEvents;

  public JooqStatsStore(StormDatabase database) {
    this(database, DEFAULT_MAX_OUTBOX_EVENTS);
  }

  public JooqStatsStore(StormDatabase database, int maxOutboxEvents) {
    if (maxOutboxEvents < 1) {
      throw new IllegalArgumentException("maxOutboxEvents must be positive");
    }
    this.database = database;
    this.maxOutboxEvents = maxOutboxEvents;
  }

  @Override
  public CompletableFuture<Void> save(StatsWrite write) {
    return database
        .write(dsl -> {
          for (var delta : write.playerDeltas()) {
            applyPlayerDelta(dsl, delta);
          }
          if (write.openSession() != null) {
            upsertOpenSession(dsl, write.openSession());
          }
          if (write.closedSessionId() != null) {
            dsl.deleteFrom(STATS_OPEN_SESSION)
                .where(STATS_OPEN_SESSION.SESSION_ID.eq(write.closedSessionId().toString()))
                .execute();
          }
          for (var draft : write.events()) {
            enqueueDraft(dsl, draft);
          }
          if (!write.events().isEmpty()) {
            trimOutbox(dsl);
          }
          return true;
        })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<Integer> recoverInterrupted(
      Instant recoveredAt, Supplier<UUID> eventIds) {
    return database.write(dsl -> {
      var openRows = dsl.selectFrom(STATS_OPEN_SESSION).fetch();
      for (var row : openRows) {
        long checkpointMs =
            Math.max(
                row.getStartedMs(), Math.min(recoveredAt.toEpochMilli(), row.getCheckpointMs()));
        var ended =
            new StatsWire.SessionEndedEvent(
                "session_ended",
                eventIds.get().toString(),
                Instant.ofEpochMilli(checkpointMs).toString(),
                row.getSessionId(),
                row.getPlayerUuid(),
                row.getPlayerName(),
                Instant.ofEpochMilli(row.getStartedMs()).toString(),
                SessionLedger.clampDuration(row.getConnectedMs()),
                SessionLedger.clampDuration(row.getActiveMs()),
                EndReason.INTERRUPTED.wire(),
                null,
                null,
                null);
        insertOutbox(
            dsl,
            UUID.fromString(ended.eventId()),
            row.getCheckpointMs(),
            JSON.writeValueAsString(ended));
      }
      if (!openRows.isEmpty()) {
        dsl.deleteFrom(STATS_OPEN_SESSION).execute();
        trimOutbox(dsl);
      }
      return openRows.size();
    });
  }

  @Override
  public CompletableFuture<Optional<PlayerStatsSummary>> findPlayer(String nameOrUuid) {
    var query = nameOrUuid.strip();
    if (query.isEmpty()) {
      return CompletableFuture.completedFuture(Optional.empty());
    }
    var parsedUuid = tryParseUuid(query);
    return database.read(dsl -> {
      var record =
          parsedUuid.isPresent()
              ? dsl.selectFrom(STATS_PLAYER)
                  .where(STATS_PLAYER.PLAYER_UUID.eq(parsedUuid.orElseThrow().toString()))
                  .fetchOne()
              : dsl.selectFrom(STATS_PLAYER)
                  .where(STATS_PLAYER.NAME_LOWER.eq(query.toLowerCase(Locale.ROOT)))
                  .orderBy(STATS_PLAYER.LAST_SEEN_MS.desc())
                  .limit(1)
                  .fetchOne();
      if (record == null) {
        return Optional.empty();
      }
      return Optional.of(
          new PlayerStatsSummary(
              UUID.fromString(record.getPlayerUuid()),
              record.getPlayerName(),
              Instant.ofEpochMilli(record.getFirstSeenMs()),
              Instant.ofEpochMilli(record.getLastSeenMs()),
              record.getConnectedMs(),
              record.getActiveMs(),
              record.getSessionsCount(),
              record.getPvpKills(),
              record.getPvpDeaths(),
              record.getMobKills()));
    });
  }

  @Override
  public CompletableFuture<Integer> countPlayers() {
    return database.read(dsl -> dsl.fetchCount(STATS_PLAYER));
  }

  @Override
  public CompletableFuture<List<PendingEvent>> pendingEvents(int limit) {
    return database.read(dsl ->
        dsl.select(STATS_OUTBOX.EVENT_ID, STATS_OUTBOX.EVENT_JSON)
            .from(STATS_OUTBOX)
            .orderBy(STATS_OUTBOX.SEQ.asc())
            .limit(limit)
            .fetch(row ->
                new PendingEvent(
                    UUID.fromString(row.get(STATS_OUTBOX.EVENT_ID)),
                    row.get(STATS_OUTBOX.EVENT_JSON))));
  }

  @Override
  public CompletableFuture<Void> acknowledgeEvents(List<UUID> eventIds) {
    if (eventIds.isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }
    var ids = eventIds.stream().map(UUID::toString).toList();
    return database
        .write(dsl -> dsl.deleteFrom(STATS_OUTBOX).where(STATS_OUTBOX.EVENT_ID.in(ids)).execute())
        .thenAccept(deleted -> {});
  }

  @Override
  public CompletableFuture<Void> resetPlayer(UUID playerUuid) {
    var id = playerUuid.toString();
    return database
        .write(dsl -> {
          dsl.deleteFrom(STATS_OPEN_SESSION).where(STATS_OPEN_SESSION.PLAYER_UUID.eq(id)).execute();
          dsl.deleteFrom(STATS_PLAYER).where(STATS_PLAYER.PLAYER_UUID.eq(id)).execute();
          return true;
        })
        .thenAccept(done -> {});
  }

  private static void applyPlayerDelta(DSLContext dsl, StatsWrite.PlayerDelta delta) {
    var uuid = delta.playerUuid().toString();
    var lower = delta.playerName().toLowerCase(Locale.ROOT);
    dsl.insertInto(STATS_PLAYER)
        .columns(
            STATS_PLAYER.PLAYER_UUID,
            STATS_PLAYER.PLAYER_NAME,
            STATS_PLAYER.NAME_LOWER,
            STATS_PLAYER.FIRST_SEEN_MS,
            STATS_PLAYER.LAST_SEEN_MS,
            STATS_PLAYER.CONNECTED_MS,
            STATS_PLAYER.ACTIVE_MS,
            STATS_PLAYER.SESSIONS_COUNT,
            STATS_PLAYER.PVP_KILLS,
            STATS_PLAYER.PVP_DEATHS,
            STATS_PLAYER.MOB_KILLS)
        .values(
            uuid,
            delta.playerName(),
            lower,
            delta.seenAtMs(),
            delta.seenAtMs(),
            delta.connectedMsDelta(),
            delta.activeMsDelta(),
            delta.sessionsDelta(),
            delta.pvpKillsDelta(),
            delta.pvpDeathsDelta(),
            delta.mobKillsDelta())
        .onConflict(STATS_PLAYER.PLAYER_UUID)
        .doUpdate()
        .set(STATS_PLAYER.PLAYER_NAME, delta.playerName())
        .set(STATS_PLAYER.NAME_LOWER, lower)
        .set(
            STATS_PLAYER.LAST_SEEN_MS,
            DSL.greatest(STATS_PLAYER.LAST_SEEN_MS, DSL.val(delta.seenAtMs())))
        .set(STATS_PLAYER.CONNECTED_MS, STATS_PLAYER.CONNECTED_MS.plus(delta.connectedMsDelta()))
        .set(STATS_PLAYER.ACTIVE_MS, STATS_PLAYER.ACTIVE_MS.plus(delta.activeMsDelta()))
        .set(STATS_PLAYER.SESSIONS_COUNT, STATS_PLAYER.SESSIONS_COUNT.plus(delta.sessionsDelta()))
        .set(STATS_PLAYER.PVP_KILLS, STATS_PLAYER.PVP_KILLS.plus(delta.pvpKillsDelta()))
        .set(STATS_PLAYER.PVP_DEATHS, STATS_PLAYER.PVP_DEATHS.plus(delta.pvpDeathsDelta()))
        .set(STATS_PLAYER.MOB_KILLS, STATS_PLAYER.MOB_KILLS.plus(delta.mobKillsDelta()))
        .execute();
  }

  private static void upsertOpenSession(DSLContext dsl, StatsWrite.OpenSessionRow row) {
    dsl.insertInto(STATS_OPEN_SESSION)
        .columns(
            STATS_OPEN_SESSION.SESSION_ID,
            STATS_OPEN_SESSION.PLAYER_UUID,
            STATS_OPEN_SESSION.PLAYER_NAME,
            STATS_OPEN_SESSION.STARTED_MS,
            STATS_OPEN_SESSION.CHECKPOINT_MS,
            STATS_OPEN_SESSION.CONNECTED_MS,
            STATS_OPEN_SESSION.ACTIVE_MS)
        .values(
            row.sessionId().toString(),
            row.playerUuid().toString(),
            row.playerName(),
            row.startedMs(),
            row.checkpointMs(),
            row.connectedMs(),
            row.activeMs())
        .onConflict(STATS_OPEN_SESSION.SESSION_ID)
        .doUpdate()
        .set(STATS_OPEN_SESSION.PLAYER_NAME, row.playerName())
        .set(STATS_OPEN_SESSION.CHECKPOINT_MS, row.checkpointMs())
        .set(STATS_OPEN_SESSION.CONNECTED_MS, row.connectedMs())
        .set(STATS_OPEN_SESSION.ACTIVE_MS, row.activeMs())
        .execute();
  }

  private static void enqueueDraft(DSLContext dsl, StatsWrite.OutboxDraft draft) {
    StatsWire.IngestEvent event =
        switch (draft) {
          case StatsWrite.OutboxDraft.Ready ready -> ready.wireEvent();
          case StatsWrite.OutboxDraft.SessionStartNeedsFirstSeen pending -> {
            var storedFirstSeen =
                dsl.select(STATS_PLAYER.FIRST_SEEN_MS)
                    .from(STATS_PLAYER)
                    .where(STATS_PLAYER.PLAYER_UUID.eq(pending.playerUuid().toString()))
                    .fetchOne(STATS_PLAYER.FIRST_SEEN_MS);
            long firstSeenMs =
                storedFirstSeen == null ? pending.occurredAt().toEpochMilli() : storedFirstSeen;
            yield new StatsWire.SessionStartedEvent(
                "session_started",
                pending.eventId().toString(),
                pending.occurredAt().toString(),
                pending.sessionId().toString(),
                pending.playerUuid().toString(),
                pending.playerName(),
                Instant.ofEpochMilli(firstSeenMs).toString(),
                pending.platform(),
                pending.clientVersion(),
                pending.clientBrand(),
                pending.joinAddress(),
                null,
                null);
          }
        };
    insertOutbox(
        dsl, draft.eventId(), draft.occurredAt().toEpochMilli(), JSON.writeValueAsString(event));
  }

  private static void insertOutbox(
      DSLContext dsl, UUID eventId, long occurredMs, String eventJson) {
    dsl.insertInto(STATS_OUTBOX)
        .columns(STATS_OUTBOX.EVENT_ID, STATS_OUTBOX.OCCURRED_MS, STATS_OUTBOX.EVENT_JSON)
        .values(eventId.toString(), occurredMs, eventJson)
        .onConflict(STATS_OUTBOX.EVENT_ID)
        .doNothing()
        .execute();
  }

  private void trimOutbox(DSLContext dsl) {
    int count = dsl.fetchCount(STATS_OUTBOX);
    if (count > maxOutboxEvents) {
      int excess = count - maxOutboxEvents;
      dsl.deleteFrom(STATS_OUTBOX)
          .where(
              STATS_OUTBOX.SEQ.in(
                  dsl.select(STATS_OUTBOX.SEQ)
                      .from(STATS_OUTBOX)
                      .orderBy(STATS_OUTBOX.SEQ.asc())
                      .limit(excess)))
          .execute();
    }
  }

  private static Optional<UUID> tryParseUuid(String candidate) {
    if (candidate.length() != 36) {
      return Optional.empty();
    }
    try {
      return Optional.of(UUID.fromString(candidate));
    } catch (IllegalArgumentException ignored) {
      return Optional.empty();
    }
  }
}
