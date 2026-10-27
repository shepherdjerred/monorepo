package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_BEST_WAVES;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_PENDING_REWARDS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SNAPSHOTS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SURVIVAL_CREDITS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SURVIVAL_TIPS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SURVIVAL_TIP_PREFERENCES;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_VAULT_CLAIMS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Arena snapshots, records, rewards and survival progression for one account. */
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
              dsl.deleteFrom(ARENA_SNAPSHOTS).where(ARENA_SNAPSHOTS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(ARENA_BEST_WAVES).where(ARENA_BEST_WAVES.PLAYER.eq(id)).execute();
              dsl.deleteFrom(ARENA_VAULT_CLAIMS).where(ARENA_VAULT_CLAIMS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(ARENA_PENDING_REWARDS)
                  .where(ARENA_PENDING_REWARDS.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ARENA_SURVIVAL_CREDITS)
                  .where(ARENA_SURVIVAL_CREDITS.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ARENA_SURVIVAL_TIPS)
                  .where(ARENA_SURVIVAL_TIPS.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ARENA_SURVIVAL_TIP_PREFERENCES)
                  .where(ARENA_SURVIVAL_TIP_PREFERENCES.PLAYER.eq(id))
                  .execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
