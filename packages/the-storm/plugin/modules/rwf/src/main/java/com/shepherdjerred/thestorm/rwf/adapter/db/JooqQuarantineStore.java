package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MAP_QUARANTINE;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwf.app.store.QuarantineStore;
import java.time.Instant;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;

/** The operator's quarantined maps in the rwf database. */
public final class JooqQuarantineStore implements QuarantineStore {

  private final StormDatabase database;

  public JooqQuarantineStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Map<String, String>> all() {
    return database.read(
        dsl -> {
          var out = new TreeMap<String, String>();
          dsl.selectFrom(RWF_MAP_QUARANTINE)
              .fetch()
              .forEach(row -> out.put(row.getMapId(), row.getReason()));
          return Map.copyOf(out);
        });
  }

  @Override
  public CompletableFuture<Void> quarantine(String mapId, String reason, String by, Instant at) {
    return Writes.done(
        database.write(
            dsl -> {
              dsl.insertInto(RWF_MAP_QUARANTINE)
                  .set(RWF_MAP_QUARANTINE.MAP_ID, mapId)
                  .set(RWF_MAP_QUARANTINE.REASON, reason)
                  .set(RWF_MAP_QUARANTINE.QUARANTINED_BY, by)
                  .set(RWF_MAP_QUARANTINE.QUARANTINED_AT, at.toEpochMilli())
                  .onConflict(RWF_MAP_QUARANTINE.MAP_ID)
                  .doUpdate()
                  .set(RWF_MAP_QUARANTINE.REASON, reason)
                  .set(RWF_MAP_QUARANTINE.QUARANTINED_BY, by)
                  .set(RWF_MAP_QUARANTINE.QUARANTINED_AT, at.toEpochMilli())
                  .execute();
              return true;
            }));
  }

  @Override
  public CompletableFuture<Void> release(String mapId) {
    return Writes.done(
        database.write(
            dsl -> {
              dsl.deleteFrom(RWF_MAP_QUARANTINE)
                  .where(RWF_MAP_QUARANTINE.MAP_ID.eq(mapId))
                  .execute();
              return true;
            }));
  }
}
