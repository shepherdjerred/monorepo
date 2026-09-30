package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_BACK_HISTORY;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.adapter.db.generated.tables.records.EssentialsBackHistoryRecord;
import com.shepherdjerred.thestorm.essentials.app.store.BackStore;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.back.BackHistory;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link BackStore} over {@code essentials_back_history}. */
public final class JooqBackStore implements BackStore {

  private final StormDatabase database;

  public JooqBackStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> push(UUID player, BackEntry entry, int capacity) {
    var position = entry.position();
    return database
        .write(
            dsl -> {
              dsl.insertInto(ESSENTIALS_BACK_HISTORY)
                  .set(ESSENTIALS_BACK_HISTORY.PLAYER, player.toString())
                  .set(ESSENTIALS_BACK_HISTORY.WORLD, position.world())
                  .set(ESSENTIALS_BACK_HISTORY.X, position.x())
                  .set(ESSENTIALS_BACK_HISTORY.Y, position.y())
                  .set(ESSENTIALS_BACK_HISTORY.Z, position.z())
                  .set(ESSENTIALS_BACK_HISTORY.YAW, (double) position.yaw())
                  .set(ESSENTIALS_BACK_HISTORY.PITCH, (double) position.pitch())
                  .set(ESSENTIALS_BACK_HISTORY.CAUSE, entry.cause().name().toLowerCase(Locale.ROOT))
                  .set(ESSENTIALS_BACK_HISTORY.AT, entry.at().toEpochMilli())
                  .execute();
              var keep =
                  dsl.select(ESSENTIALS_BACK_HISTORY.ID)
                      .from(ESSENTIALS_BACK_HISTORY)
                      .where(ESSENTIALS_BACK_HISTORY.PLAYER.eq(player.toString()))
                      .orderBy(ESSENTIALS_BACK_HISTORY.ID.desc())
                      .limit(capacity);
              dsl.deleteFrom(ESSENTIALS_BACK_HISTORY)
                  .where(ESSENTIALS_BACK_HISTORY.PLAYER.eq(player.toString()))
                  .and(ESSENTIALS_BACK_HISTORY.ID.notIn(keep))
                  .execute();
              return true;
            })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<BackHistory> history(UUID player, int capacity) {
    return database.read(
        dsl ->
            BackHistory.of(
                capacity,
                dsl.selectFrom(ESSENTIALS_BACK_HISTORY)
                    .where(ESSENTIALS_BACK_HISTORY.PLAYER.eq(player.toString()))
                    .orderBy(ESSENTIALS_BACK_HISTORY.ID.desc())
                    .limit(capacity)
                    .fetch(JooqBackStore::toEntry)));
  }

  private static BackEntry toEntry(EssentialsBackHistoryRecord row) {
    return new BackEntry(
        new Position(
            row.getWorld(),
            row.getX(),
            row.getY(),
            row.getZ(),
            row.getYaw().floatValue(),
            row.getPitch().floatValue()),
        BackEntry.Cause.valueOf(row.getCause().toUpperCase(Locale.ROOT)),
        Instant.ofEpochMilli(row.getAt()));
  }
}
