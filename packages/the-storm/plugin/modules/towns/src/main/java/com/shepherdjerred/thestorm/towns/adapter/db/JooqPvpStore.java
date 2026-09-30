package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_PVP;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.app.PvpStore;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpSetting;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Players' own PvP switches in SQLite, one row per player who has changed theirs. */
public final class JooqPvpStore implements PvpStore {

  private final StormDatabase database;

  public JooqPvpStore(StormDatabase database) {
    this.database = database;
  }

  /** Read on the writer thread, so a reload sees every write queued before it. */
  @Override
  public CompletableFuture<Map<UUID, PvpSetting>> loadAll() {
    return database.write(
        dsl -> {
          var settings = new HashMap<UUID, PvpSetting>();
          for (var row : dsl.selectFrom(TOWNS_PVP).fetch()) {
            settings.put(
                UUID.fromString(row.getPlayerId()),
                new PvpSetting(row.getPvpOn() == 1, Instant.ofEpochMilli(row.getChangedAt())));
          }
          return Map.copyOf(settings);
        });
  }

  @Override
  public CompletableFuture<Void> save(UUID player, PvpSetting setting) {
    var on = setting.on() ? 1 : 0;
    var at = setting.changedAt().toEpochMilli();
    return database
        .write(
            dsl ->
                dsl.insertInto(TOWNS_PVP)
                    .set(TOWNS_PVP.PLAYER_ID, player.toString())
                    .set(TOWNS_PVP.PVP_ON, on)
                    .set(TOWNS_PVP.CHANGED_AT, at)
                    .onConflict(TOWNS_PVP.PLAYER_ID)
                    .doUpdate()
                    .set(TOWNS_PVP.PVP_ON, on)
                    .set(TOWNS_PVP.CHANGED_AT, at)
                    .execute())
        .thenAccept(rows -> {});
  }
}
