package com.shepherdjerred.thestorm.mobs.adapter.db;

import static java.util.Objects.requireNonNull;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.table;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.mobs.app.BeginnerTimeStore;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** All reads and monotonic checkpoints use the shared asynchronous database executor. */
public final class JooqBeginnerTimeStore implements BeginnerTimeStore {
  private final StormDatabase database;

  public JooqBeginnerTimeStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Map<UUID, Long>> load() {
    return database.read(
        dsl ->
            dsl.select(field("player", String.class), field("active_ms", Long.class))
                .from(table("mobs_beginner_time"))
                .fetchMap(
                    row -> UUID.fromString(requireNonNull(row.value1())),
                    row -> requireNonNull(row.value2())));
  }

  /** Deletes one player's durable beginner allowance. */
  @Override
  public CompletableFuture<Void> reset(UUID player) {
    return database
        .write(
            dsl ->
                dsl.deleteFrom(table("mobs_beginner_time"))
                    .where(field("player", String.class).eq(player.toString()))
                    .execute())
        .thenAccept(ignored -> {});
  }

  @Override
  public CompletableFuture<Void> save(UUID player, long activeMillis) {
    return database
        .write(
            dsl -> {
              dsl.execute(
                  "INSERT INTO mobs_beginner_time (player, active_ms) VALUES (?, ?) "
                      + "ON CONFLICT(player) DO UPDATE SET active_ms = MAX(active_ms, excluded.active_ms)",
                  player.toString(),
                  activeMillis);
              return activeMillis;
            })
        .thenAccept(ignored -> {});
  }
}
