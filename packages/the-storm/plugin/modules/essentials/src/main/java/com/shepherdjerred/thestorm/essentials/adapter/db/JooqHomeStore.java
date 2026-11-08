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
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link HomeStore} over {@code essentials_homes}. */
public final class JooqHomeStore implements HomeStore {

  private final StormDatabase database;
  private final CompletableFuture<Void> ready;

  public JooqHomeStore(StormDatabase database) {
    this(database, CompletableFuture.completedFuture(null));
  }

  /**
   * Waits for the historical import attempt, whose failure is reported by its caller. A failed
   * archive import must not disable ordinary home storage.
   */
  public JooqHomeStore(StormDatabase database, CompletableFuture<Void> ready) {
    this.database = database;
    this.ready = ready.handle((ignored, failure) -> null);
  }

  private <T> CompletableFuture<T> read(java.util.function.Function<org.jooq.DSLContext, T> work) {
    return ready.thenCompose(ignored -> database.read(work));
  }

  private <T> CompletableFuture<T> write(java.util.function.Function<org.jooq.DSLContext, T> work) {
    return ready.thenCompose(ignored -> database.write(work));
  }

  @Override
  public CompletableFuture<List<Home>> homes(UUID player) {
    return read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_HOMES)
                .where(ESSENTIALS_HOMES.PLAYER.eq(player.toString()))
                .orderBy(ESSENTIALS_HOMES.NAME)
                .fetch(JooqHomeStore::toHome));
  }

  @Override
  public CompletableFuture<Result<HomeRules.Change, HomeError>> set(
      UUID player, Home home, int limit) {
    return write(
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
  public CompletableFuture<Set<UUID>> bedOwners() {
    return read(
        dsl ->
            dsl.select(ESSENTIALS_HOMES.PLAYER)
                .from(ESSENTIALS_HOMES)
                .where(ESSENTIALS_HOMES.NAME.eq(HomeRules.BED.value()))
                .fetchSet(row -> UUID.fromString(row.value1())));
  }

  @Override
  public CompletableFuture<Boolean> insertBedIfAbsent(UUID player, Position position) {
    return write(
        dsl ->
            dsl.insertInto(ESSENTIALS_HOMES)
                    .set(ESSENTIALS_HOMES.PLAYER, player.toString())
                    .set(ESSENTIALS_HOMES.NAME, HomeRules.BED.value())
                    .set(ESSENTIALS_HOMES.WORLD, position.world())
                    .set(ESSENTIALS_HOMES.X, position.x())
                    .set(ESSENTIALS_HOMES.Y, position.y())
                    .set(ESSENTIALS_HOMES.Z, position.z())
                    .set(ESSENTIALS_HOMES.YAW, (double) position.yaw())
                    .set(ESSENTIALS_HOMES.PITCH, (double) position.pitch())
                    .onConflict(ESSENTIALS_HOMES.PLAYER, ESSENTIALS_HOMES.NAME)
                    .doNothing()
                    .execute()
                == 1);
  }

  @Override
  public CompletableFuture<Boolean> deleteBedIfMatches(UUID player, Position position) {
    return write(
        dsl ->
            dsl.deleteFrom(ESSENTIALS_HOMES)
                    .where(
                        ESSENTIALS_HOMES.PLAYER.eq(player.toString()),
                        ESSENTIALS_HOMES.NAME.eq(HomeRules.BED.value()),
                        ESSENTIALS_HOMES.WORLD.eq(position.world()),
                        ESSENTIALS_HOMES.X.eq(position.x()),
                        ESSENTIALS_HOMES.Y.eq(position.y()),
                        ESSENTIALS_HOMES.Z.eq(position.z()),
                        ESSENTIALS_HOMES.YAW.eq((double) position.yaw()),
                        ESSENTIALS_HOMES.PITCH.eq((double) position.pitch()))
                    .execute()
                == 1);
  }

  @Override
  public CompletableFuture<Boolean> delete(UUID player, PlaceName name) {
    return write(
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

  @Override
  public CompletableFuture<Boolean> rename(UUID player, PlaceName from, PlaceName to) {
    return write(
        sql -> {
          var owner = ESSENTIALS_HOMES.PLAYER.eq(player.toString());
          if (sql.fetchExists(
              sql.selectFrom(ESSENTIALS_HOMES)
                  .where(owner)
                  .and(ESSENTIALS_HOMES.NAME.eq(to.value())))) return false;
          return sql.update(ESSENTIALS_HOMES)
                  .set(ESSENTIALS_HOMES.NAME, to.value())
                  .where(owner)
                  .and(ESSENTIALS_HOMES.NAME.eq(from.value()))
                  .execute()
              == 1;
        });
  }
}
