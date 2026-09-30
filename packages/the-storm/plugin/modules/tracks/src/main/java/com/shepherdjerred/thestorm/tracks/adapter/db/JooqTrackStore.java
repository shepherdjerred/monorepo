package com.shepherdjerred.thestorm.tracks.adapter.db;

import static com.shepherdjerred.thestorm.tracks.adapter.db.generated.Tables.TRACKS_LEVEL;
import static com.shepherdjerred.thestorm.tracks.adapter.db.generated.Tables.TRACKS_PLAYER;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackStore;
import com.shepherdjerred.thestorm.tracks.domain.TrackIds;
import com.shepherdjerred.thestorm.tracks.domain.TrackLevel;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import org.jooq.DSLContext;

/**
 * Track progress in SQLite. Updates read, change and write in one transaction on the database's
 * single writer thread, so two changes to one player never interleave.
 */
public final class JooqTrackStore implements TrackStore {

  private final StormDatabase database;

  public JooqTrackStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<TrackProgress> load(UUID player) {
    return database.read(dsl -> fetch(dsl, player.toString()));
  }

  @Override
  public <E> CompletableFuture<Result<TrackProgress, E>> update(
      UUID player, Function<TrackProgress, Result<TrackProgress, E>> change) {
    var id = player.toString();
    return database.write(
        dsl -> {
          var current = fetch(dsl, id);
          return change
              .apply(current)
              .map(
                  next -> {
                    if (next.equals(current)) {
                      return current;
                    }
                    store(dsl, id, next);
                    // Read back what was stored (times keep only milliseconds).
                    return fetch(dsl, id);
                  });
        });
  }

  private static TrackProgress fetch(DSLContext dsl, String id) {
    var player =
        dsl.select(TRACKS_PLAYER.LAST_PURCHASE_AT)
            .from(TRACKS_PLAYER)
            .where(TRACKS_PLAYER.PLAYER_ID.eq(id))
            .fetchOptional();
    if (player.isEmpty()) {
      return TrackProgress.empty();
    }
    var owned =
        dsl.select(TRACKS_LEVEL.TRACK, TRACKS_LEVEL.LEVEL)
            .from(TRACKS_LEVEL)
            .where(TRACKS_LEVEL.PLAYER_ID.eq(id))
            .orderBy(TRACKS_LEVEL.POSITION.asc())
            .fetch(row -> new TrackLevel(track(row.value1()), row.value2()));
    var lastPurchase = Optional.ofNullable(player.get().value1()).map(Instant::ofEpochMilli);
    return new TrackProgress(owned, lastPurchase);
  }

  private static void store(DSLContext dsl, String id, TrackProgress progress) {
    dsl.deleteFrom(TRACKS_LEVEL).where(TRACKS_LEVEL.PLAYER_ID.eq(id)).execute();
    dsl.deleteFrom(TRACKS_PLAYER).where(TRACKS_PLAYER.PLAYER_ID.eq(id)).execute();
    if (progress.equals(TrackProgress.empty())) {
      return;
    }
    dsl.insertInto(TRACKS_PLAYER)
        .set(TRACKS_PLAYER.PLAYER_ID, id)
        .set(
            TRACKS_PLAYER.LAST_PURCHASE_AT,
            progress.lastPurchase().map(Instant::toEpochMilli).orElse(null))
        .execute();
    var owned = progress.owned();
    for (var position = 0; position < owned.size(); position++) {
      var entry = owned.get(position);
      dsl.insertInto(TRACKS_LEVEL)
          .set(TRACKS_LEVEL.PLAYER_ID, id)
          .set(TRACKS_LEVEL.TRACK, entry.track().id())
          .set(TRACKS_LEVEL.LEVEL, entry.level())
          .set(TRACKS_LEVEL.POSITION, position)
          .execute();
    }
  }

  private static Track track(String id) {
    return TrackIds.parse(id)
        .orElseThrow(() -> new IllegalStateException("unknown track stored: " + id));
  }
}
