package com.shepherdjerred.thestorm.reset.adapter.db;

import static com.shepherdjerred.thestorm.reset.adapter.db.generated.Tables.RESET_PENDING;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.reset.app.ResetStore;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

/** Pending resets in the shared SQLite database. */
public final class JooqResetStore implements ResetStore {

  private final StormDatabase database;

  public JooqResetStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> begin(UUID player, Instant startedAt) {
    return database
        .write(
            dsl ->
                dsl.insertInto(RESET_PENDING)
                    .set(RESET_PENDING.PLAYER, player.toString())
                    .set(RESET_PENDING.STARTED_AT, startedAt.toEpochMilli())
                    .onConflict(RESET_PENDING.PLAYER)
                    .doNothing()
                    .execute())
        .thenAccept(rows -> {});
  }

  @Override
  public CompletableFuture<Set<UUID>> pending() {
    return database.read(
        dsl ->
            dsl
                .select(RESET_PENDING.PLAYER)
                .from(RESET_PENDING)
                .fetch(RESET_PENDING.PLAYER)
                .stream()
                .map(UUID::fromString)
                .collect(Collectors.toUnmodifiableSet()));
  }

  @Override
  public CompletableFuture<Boolean> isPending(UUID player) {
    return database.read(
        dsl ->
            dsl.fetchExists(
                dsl.selectOne()
                    .from(RESET_PENDING)
                    .where(RESET_PENDING.PLAYER.eq(player.toString()))));
  }

  @Override
  public CompletableFuture<Void> finish(UUID player) {
    return database
        .write(
            dsl ->
                dsl.deleteFrom(RESET_PENDING)
                    .where(RESET_PENDING.PLAYER.eq(player.toString()))
                    .execute())
        .thenAccept(rows -> {});
  }
}
