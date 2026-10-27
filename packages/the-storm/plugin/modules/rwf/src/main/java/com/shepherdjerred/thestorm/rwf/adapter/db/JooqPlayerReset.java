package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_DAILY_EARNINGS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_KIT_OWNED;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_KIT_PURCHASE;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH_EVENT;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH_PLAYER;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_KIT_STATS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_PREFS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_STATS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_SNAPSHOTS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_STREAK_PREFS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** RWF snapshots, history, statistics, purchases and preferences for one account. */
public final class JooqPlayerReset {

  private final StormDatabase database;

  public JooqPlayerReset(StormDatabase database) {
    this.database = database;
  }

  public CompletableFuture<Void> reset(UUID player) {
    var id = player.toString();
    return database
        .write(
            dsl -> {
              dsl.deleteFrom(RWF_SNAPSHOTS).where(RWF_SNAPSHOTS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(RWF_MATCH_PLAYER).where(RWF_MATCH_PLAYER.PLAYER.eq(id)).execute();
              dsl.deleteFrom(RWF_MATCH_EVENT)
                  .where(RWF_MATCH_EVENT.ACTOR.eq(id).or(RWF_MATCH_EVENT.TARGET.eq(id)))
                  .execute();
              dsl.deleteFrom(RWF_PLAYER_STATS).where(RWF_PLAYER_STATS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(RWF_PLAYER_KIT_STATS)
                  .where(RWF_PLAYER_KIT_STATS.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(RWF_PLAYER_PREFS).where(RWF_PLAYER_PREFS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(RWF_STREAK_PREFS).where(RWF_STREAK_PREFS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(RWF_DAILY_EARNINGS).where(RWF_DAILY_EARNINGS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(RWF_KIT_OWNED).where(RWF_KIT_OWNED.PLAYER.eq(id)).execute();
              dsl.deleteFrom(RWF_KIT_PURCHASE).where(RWF_KIT_PURCHASE.PLAYER.eq(id)).execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
