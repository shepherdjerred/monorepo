package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_WARPS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.adapter.db.generated.tables.records.EssentialsWarpsRecord;
import com.shepherdjerred.thestorm.essentials.app.store.WarpStore;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.place.Warp;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** {@link WarpStore} over {@code essentials_warps}. */
public final class JooqWarpStore implements WarpStore {

  private final StormDatabase database;

  public JooqWarpStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<Warp>> all() {
    return database.read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_WARPS)
                .orderBy(ESSENTIALS_WARPS.NAME)
                .fetch(JooqWarpStore::toWarp));
  }

  @Override
  public CompletableFuture<Void> save(Warp warp) {
    var position = warp.position();
    return database
        .write(
            dsl -> {
              dsl.insertInto(ESSENTIALS_WARPS)
                  .set(ESSENTIALS_WARPS.NAME, warp.name().value())
                  .set(ESSENTIALS_WARPS.WORLD, position.world())
                  .set(ESSENTIALS_WARPS.X, position.x())
                  .set(ESSENTIALS_WARPS.Y, position.y())
                  .set(ESSENTIALS_WARPS.Z, position.z())
                  .set(ESSENTIALS_WARPS.YAW, (double) position.yaw())
                  .set(ESSENTIALS_WARPS.PITCH, (double) position.pitch())
                  .onConflict(ESSENTIALS_WARPS.NAME)
                  .doUpdate()
                  .set(ESSENTIALS_WARPS.WORLD, position.world())
                  .set(ESSENTIALS_WARPS.X, position.x())
                  .set(ESSENTIALS_WARPS.Y, position.y())
                  .set(ESSENTIALS_WARPS.Z, position.z())
                  .set(ESSENTIALS_WARPS.YAW, (double) position.yaw())
                  .set(ESSENTIALS_WARPS.PITCH, (double) position.pitch())
                  .execute();
              return true;
            })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<Boolean> delete(PlaceName name) {
    return database.write(
        dsl ->
            dsl.deleteFrom(ESSENTIALS_WARPS).where(ESSENTIALS_WARPS.NAME.eq(name.value())).execute()
                > 0);
  }

  private static Warp toWarp(EssentialsWarpsRecord row) {
    return new Warp(
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
