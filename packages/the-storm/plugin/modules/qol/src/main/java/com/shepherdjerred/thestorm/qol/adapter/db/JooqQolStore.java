package com.shepherdjerred.thestorm.qol.adapter.db;

import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_PLAYER;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.app.Ensured;
import com.shepherdjerred.thestorm.qol.app.PlayerProfile;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.app.StoredGrave;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;

/** {@link QolStore} in SQLite. */
public final class JooqQolStore implements QolStore {

  private final StormDatabase database;

  public JooqQolStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Ensured> ensure(UUID player, Instant now) {
    return database.write(dsl -> ensure(dsl, player, now));
  }

  @Override
  public CompletableFuture<Void> setLastRtp(UUID player, Instant when) {
    return write(
        dsl ->
            dsl.update(QOL_PLAYER)
                .set(QOL_PLAYER.LAST_RTP, when.toEpochMilli())
                .where(QOL_PLAYER.PLAYER.eq(player.toString()))
                .execute());
  }

  @Override
  public CompletableFuture<Void> insertGrave(StoredGrave grave) {
    return write(
        dsl ->
            dsl.insertInto(QOL_GRAVE)
                .set(QOL_GRAVE.ID, grave.id().toString())
                .set(QOL_GRAVE.OWNER, grave.owner().toString())
                .set(QOL_GRAVE.WORLD, grave.world())
                .set(QOL_GRAVE.X, grave.x())
                .set(QOL_GRAVE.Y, grave.y())
                .set(QOL_GRAVE.Z, grave.z())
                .set(QOL_GRAVE.EXPIRES, grave.expires().toEpochMilli())
                .execute());
  }

  @Override
  public CompletableFuture<Optional<StoredGrave>> graveAt(String world, int x, int y, int z) {
    return database.read(
        dsl ->
            Optional.ofNullable(
                    dsl.selectFrom(QOL_GRAVE)
                        .where(QOL_GRAVE.WORLD.eq(world))
                        .and(QOL_GRAVE.X.eq(x))
                        .and(QOL_GRAVE.Y.eq(y))
                        .and(QOL_GRAVE.Z.eq(z))
                        .fetchOne())
                .map(JooqQolStore::grave));
  }

  @Override
  public CompletableFuture<List<StoredGrave>> due(Instant now) {
    return database.read(
        dsl ->
            dsl.selectFrom(QOL_GRAVE)
                .where(QOL_GRAVE.EXPIRES.le(now.toEpochMilli()))
                .fetch(JooqQolStore::grave));
  }

  @Override
  public CompletableFuture<Void> deleteGrave(UUID id) {
    return write(dsl -> dsl.deleteFrom(QOL_GRAVE).where(QOL_GRAVE.ID.eq(id.toString())).execute());
  }

  private CompletableFuture<Void> write(Consumer<DSLContext> work) {
    return database
        .write(
            dsl -> {
              work.accept(dsl);
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }

  private static Ensured ensure(DSLContext dsl, UUID player, Instant now) {
    var row = dsl.selectFrom(QOL_PLAYER).where(QOL_PLAYER.PLAYER.eq(player.toString())).fetchOne();
    if (row != null) {
      return new Ensured(profile(row), false);
    }
    dsl.insertInto(QOL_PLAYER)
        .set(QOL_PLAYER.PLAYER, player.toString())
        .set(QOL_PLAYER.FIRST_SEEN, now.toEpochMilli())
        .execute();
    return new Ensured(new PlayerProfile(player, now, Optional.empty()), true);
  }

  private static PlayerProfile profile(
      com.shepherdjerred.thestorm.qol.adapter.db.generated.tables.records.QolPlayerRecord row) {
    return new PlayerProfile(
        UUID.fromString(row.getPlayer()),
        Instant.ofEpochMilli(row.getFirstSeen()),
        instant(row.getLastRtp()));
  }

  private static StoredGrave grave(
      com.shepherdjerred.thestorm.qol.adapter.db.generated.tables.records.QolGraveRecord row) {
    return new StoredGrave(
        UUID.fromString(row.getId()),
        UUID.fromString(row.getOwner()),
        row.getWorld(),
        row.getX(),
        row.getY(),
        row.getZ(),
        Instant.ofEpochMilli(row.getExpires()));
  }

  private static Optional<Instant> instant(@Nullable Long millis) {
    if (millis == null) {
      return Optional.empty();
    }
    return Optional.of(Instant.ofEpochMilli(millis));
  }
}
