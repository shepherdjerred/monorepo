package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_HOMES;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.adapter.db.generated.tables.records.EssentialsHomesRecord;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.essentials.domain.home.Home;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeError;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeRules;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link HomeStore} over {@code essentials_homes}. */
public final class JooqHomeStore implements HomeStore {

  private final StormDatabase database;

  public JooqHomeStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<Home>> homes(UUID player) {
    return database.read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_HOMES)
                .where(ESSENTIALS_HOMES.PLAYER.eq(player.toString()))
                .orderBy(ESSENTIALS_HOMES.NAME)
                .fetch(JooqHomeStore::toHome));
  }

  @Override
  public CompletableFuture<Result<HomeRules.Change, HomeError>> set(
      UUID player, Home home, int limit) {
    return database.write(
        dsl -> {
          var existing =
              dsl.select(ESSENTIALS_HOMES.NAME)
                  .from(ESSENTIALS_HOMES)
                  .where(ESSENTIALS_HOMES.PLAYER.eq(player.toString()))
                  .fetch(row -> new PlaceName(row.value1()));
          var decision = HomeRules.set(existing, home.name(), limit);
          if (decision.isOk()) {
            var position = home.position();
            dsl.insertInto(ESSENTIALS_HOMES)
                .set(ESSENTIALS_HOMES.PLAYER, player.toString())
                .set(ESSENTIALS_HOMES.NAME, home.name().value())
                .set(ESSENTIALS_HOMES.WORLD, position.world())
                .set(ESSENTIALS_HOMES.X, position.x())
                .set(ESSENTIALS_HOMES.Y, position.y())
                .set(ESSENTIALS_HOMES.Z, position.z())
                .set(ESSENTIALS_HOMES.YAW, (double) position.yaw())
                .set(ESSENTIALS_HOMES.PITCH, (double) position.pitch())
                .onConflict(ESSENTIALS_HOMES.PLAYER, ESSENTIALS_HOMES.NAME)
                .doUpdate()
                .set(ESSENTIALS_HOMES.WORLD, position.world())
                .set(ESSENTIALS_HOMES.X, position.x())
                .set(ESSENTIALS_HOMES.Y, position.y())
                .set(ESSENTIALS_HOMES.Z, position.z())
                .set(ESSENTIALS_HOMES.YAW, (double) position.yaw())
                .set(ESSENTIALS_HOMES.PITCH, (double) position.pitch())
                .execute();
          }
          return decision;
        });
  }

  @Override
  public CompletableFuture<Boolean> delete(UUID player, PlaceName name) {
    return database.write(
        dsl ->
            dsl.deleteFrom(ESSENTIALS_HOMES)
                    .where(ESSENTIALS_HOMES.PLAYER.eq(player.toString()))
                    .and(ESSENTIALS_HOMES.NAME.eq(name.value()))
                    .execute()
                > 0);
  }

  private static Home toHome(EssentialsHomesRecord row) {
    return new Home(
        new PlaceName(row.getName()),
        new Position(
            row.getWorld(),
            row.getX(),
            row.getY(),
            row.getZ(),
            row.getYaw().floatValue(),
            row.getPitch().floatValue()));
  }
}
