package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_PLAYERS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** How many Return items a player may still receive. Null means they have not died yet. */
public final class JooqReturnCharges {
  private final StormDatabase database;

  public JooqReturnCharges(StormDatabase database) {
    this.database = database;
  }

  public CompletableFuture<OptionalInt> read(UUID player) {
    return database.read(
        dsl -> {
          var value =
              dsl.select(ESSENTIALS_PLAYERS.RETURN_CHARGES)
                  .from(ESSENTIALS_PLAYERS)
                  .where(ESSENTIALS_PLAYERS.PLAYER.eq(player.toString()))
                  .fetchOne(ESSENTIALS_PLAYERS.RETURN_CHARGES);
          return value == null ? OptionalInt.empty() : OptionalInt.of(value);
        });
  }

  public CompletableFuture<Void> write(UUID player, int charges) {
    return database
        .write(
            dsl -> {
              dsl.update(ESSENTIALS_PLAYERS)
                  .set(ESSENTIALS_PLAYERS.RETURN_CHARGES, charges)
                  .where(ESSENTIALS_PLAYERS.PLAYER.eq(player.toString()))
                  .execute();
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }
}
