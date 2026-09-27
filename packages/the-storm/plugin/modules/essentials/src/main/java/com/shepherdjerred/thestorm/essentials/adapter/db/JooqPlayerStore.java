package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_PLAYERS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.app.store.PlayerStore;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link PlayerStore} over {@code essentials_players}. */
public final class JooqPlayerStore implements PlayerStore {

  private final StormDatabase database;

  public JooqPlayerStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Boolean> recordJoin(KnownPlayer player) {
    var id = player.uuid().toString();
    var at = player.lastSeen().toEpochMilli();
    return database.write(
        dsl -> {
          var inserted =
              dsl.insertInto(ESSENTIALS_PLAYERS)
                  .set(ESSENTIALS_PLAYERS.PLAYER, id)
                  .set(ESSENTIALS_PLAYERS.LAST_NAME, player.name())
                  .set(ESSENTIALS_PLAYERS.FIRST_JOINED_AT, at)
                  .set(ESSENTIALS_PLAYERS.LAST_SEEN_AT, at)
                  .onConflictDoNothing()
                  .execute();
          if (inserted == 0) {
            dsl.update(ESSENTIALS_PLAYERS)
                .set(ESSENTIALS_PLAYERS.LAST_NAME, player.name())
                .set(ESSENTIALS_PLAYERS.LAST_SEEN_AT, at)
                .where(ESSENTIALS_PLAYERS.PLAYER.eq(id))
                .execute();
          }
          return inserted > 0;
        });
  }

  @Override
  public CompletableFuture<List<KnownPlayer>> all() {
    return database.read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_PLAYERS)
                .fetch(
                    row ->
                        new KnownPlayer(
                            UUID.fromString(row.getPlayer()),
                            row.getLastName(),
                            Instant.ofEpochMilli(row.getLastSeenAt()))));
  }
}
