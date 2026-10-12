package com.shepherdjerred.thestorm.core.analytics;

import static java.util.Objects.requireNonNull;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.table;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;
import org.jooq.Record;
import tools.jackson.databind.json.JsonMapper;

/** Session snapshots and events are committed together, before any delivery is attempted. */
final class AnalyticsStore {
  record Pending(UUID id, String payload) {}

  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final StormDatabase database;
  private final String stage;

  AnalyticsStore(StormDatabase database, String stage) {
    this.database = database;
    this.stage = stage;
  }

  CompletableFuture<Void> save(AnalyticsWrite write) {
    return database
        .write(
            dsl -> {
              saveSession(dsl, write.connection());
              for (var event : write.events()) enqueue(dsl, write.connection(), event);
              return true;
            })
        .thenAccept(done -> {});
  }

  CompletableFuture<Void> recover() {
    return database
        .write(
            dsl -> {
              var open =
                  dsl.select(
                          field("session_id", String.class),
                          field("player_uuid", String.class),
                          field("player_name", String.class),
                          field("started_at", Long.class),
                          field("checkpoint_at", Long.class),
                          field("connected_ms", Long.class),
                          field("active_ms", Long.class))
                      .from(table("core_analytics_session"))
                      .where(
                          field("ended", Integer.class)
                              .eq(0)
                              .and(field("stage", String.class).eq(stage)))
                      .fetch();
              for (var row : open) {
                var connection = connection(row);
                var event =
                    new AnalyticsEvent(
                        UUID.randomUUID(),
                        "storm_session_ended",
                        connection.checkpoint(),
                        Map.of(
                            "connected_ms",
                            connection.connectedMillis(),
                            "active_ms",
                            connection.activeMillis(),
                            "end_reason",
                            "interrupted"));
                enqueue(dsl, connection, event);
                dsl.update(table("core_analytics_session"))
                    .set(field("ended", Integer.class), 1)
                    .where(field("session_id", String.class).eq(connection.id().toString()))
                    .execute();
              }
              return true;
            })
        .thenAccept(done -> {});
  }

  CompletableFuture<List<Pending>> pending() {
    return database.read(
        dsl ->
            dsl.select(field("event_id", String.class), field("payload", String.class))
                .from(table("core_analytics_outbox"))
                .where(field("stage", String.class).eq(stage))
                .orderBy(field("occurred_at"), field("event_id"))
                .limit(100)
                .fetch(
                    row ->
                        new Pending(
                            UUID.fromString(requireNonNull(row.get("event_id", String.class))),
                            requireNonNull(row.get("payload", String.class)))));
  }

  CompletableFuture<Void> acknowledge(List<Pending> batch) {
    return database
        .write(
            dsl -> {
              dsl.deleteFrom(table("core_analytics_outbox"))
                  .where(
                      field("event_id", String.class)
                          .in(batch.stream().map(event -> event.id().toString()).toList()))
                  .execute();
              return true;
            })
        .thenAccept(done -> {});
  }

  private void saveSession(DSLContext dsl, AnalyticsWrite.Connection session) {
    dsl.insertInto(table("core_analytics_player"))
        .columns(field("player_uuid"), field("stage"), field("first_seen"))
        .values(session.player().toString(), stage, session.started().toEpochMilli())
        .onConflict(field("player_uuid"), field("stage"))
        .doNothing()
        .execute();
    dsl.insertInto(table("core_analytics_session"))
        .columns(
            field("session_id"),
            field("stage"),
            field("player_uuid"),
            field("player_name"),
            field("started_at"),
            field("checkpoint_at"),
            field("connected_ms"),
            field("active_ms"),
            field("ended"))
        .values(
            session.id().toString(),
            stage,
            session.player().toString(),
            session.name(),
            session.started().toEpochMilli(),
            session.checkpoint().toEpochMilli(),
            session.connectedMillis(),
            session.activeMillis(),
            session.ended() ? 1 : 0)
        .onConflict(field("session_id"))
        .doUpdate()
        .set(field("checkpoint_at", Long.class), session.checkpoint().toEpochMilli())
        .set(field("connected_ms", Long.class), session.connectedMillis())
        .set(field("active_ms", Long.class), session.activeMillis())
        .set(field("ended", Integer.class), session.ended() ? 1 : 0)
        .execute();
  }

  private void enqueue(DSLContext dsl, AnalyticsWrite.Connection session, AnalyticsEvent event) {
    var firstSeen =
        requireNonNull(
            dsl.select(field("first_seen", Long.class))
                .from(table("core_analytics_player"))
                .where(
                    field("player_uuid", String.class)
                        .eq(session.player().toString())
                        .and(field("stage", String.class).eq(stage)))
                .fetchOne(field("first_seen", Long.class)));
    var properties = new HashMap<String, Object>(event.properties());
    properties.put("event_id", event.id().toString());
    properties.put("$insert_id", event.id().toString());
    properties.put("session_id", session.id().toString());
    properties.put("first_seen_at", Instant.ofEpochMilli(firstSeen).toString());
    properties.put("stage", stage);
    properties.put("site_key", "ts-mc");
    properties.put("site_hostname", "ts-mc.net");
    properties.put("source", "minecraft");
    properties.put("schema_version", 1);
    properties.put("$geoip_disable", true);
    properties.put("$process_person_profile", true);
    properties.put(
        "$set", Map.of("name", session.name(), "minecraft_uuid", session.player().toString()));
    var payload =
        JSON.writeValueAsString(
            Map.of(
                "uuid",
                event.id().toString(),
                "event",
                event.event(),
                "timestamp",
                event.at().toString(),
                "distinct_id",
                "the-storm:" + stage + ":player:" + session.player(),
                "properties",
                properties));
    dsl.insertInto(table("core_analytics_outbox"))
        .columns(field("event_id"), field("stage"), field("occurred_at"), field("payload"))
        .values(event.id().toString(), stage, event.at().toEpochMilli(), payload)
        .execute();
  }

  private static AnalyticsWrite.Connection connection(Record row) {
    return new AnalyticsWrite.Connection(
        UUID.fromString(requireNonNull(row.get("session_id", String.class))),
        UUID.fromString(requireNonNull(row.get("player_uuid", String.class))),
        requireNonNull(row.get("player_name", String.class)),
        Instant.ofEpochMilli(requireNonNull(row.get("started_at", Long.class))),
        Instant.ofEpochMilli(requireNonNull(row.get("checkpoint_at", Long.class))),
        requireNonNull(row.get("connected_ms", Long.class)),
        requireNonNull(row.get("active_ms", Long.class)),
        true);
  }
}
