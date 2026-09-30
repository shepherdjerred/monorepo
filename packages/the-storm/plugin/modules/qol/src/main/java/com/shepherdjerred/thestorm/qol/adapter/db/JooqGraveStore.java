package com.shepherdjerred.thestorm.qol.adapter.db;

import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVES;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE_CLAIMS;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE_CREATIONS;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE_DROPS;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE_EXPIRIES;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE_ITEMS;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_NOTICES;
import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.adapter.db.generated.tables.records.QolGraveDropsRecord;
import com.shepherdjerred.thestorm.qol.adapter.db.generated.tables.records.QolGraveItemsRecord;
import com.shepherdjerred.thestorm.qol.adapter.db.generated.tables.records.QolGravesRecord;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import com.shepherdjerred.thestorm.qol.domain.grave.ItemBytes;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;

/** {@link GraveStore} over {@code qol_graves} and {@code qol_grave_items}. */
public final class JooqGraveStore implements GraveStore {

  private record Projection(GravePos pos, boolean ownerOnly) {}

  private final StormDatabase database;

  public JooqGraveStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<GraveContents>> loadAll() {
    return database.read(
        dsl -> {
          var items = new HashMap<String, List<GraveItem>>();
          dsl.selectFrom(QOL_GRAVE_ITEMS)
              .where(
                  DSL.notExists(
                      DSL.selectOne()
                          .from(QOL_GRAVE_DROPS)
                          .where(
                              QOL_GRAVE_DROPS.GRAVE.eq(QOL_GRAVE_ITEMS.GRAVE),
                              QOL_GRAVE_DROPS.IDX.eq(QOL_GRAVE_ITEMS.IDX))))
              .orderBy(QOL_GRAVE_ITEMS.GRAVE, QOL_GRAVE_ITEMS.IDX)
              .forEach(
                  row ->
                      items
                          .computeIfAbsent(row.getGrave(), grave -> new ArrayList<>())
                          .add(toItem(row)));
          return dsl.selectFrom(QOL_GRAVES)
              .orderBy(QOL_GRAVES.CREATED_AT, QOL_GRAVES.ID)
              .fetch(
                  row ->
                      new GraveContents(toGrave(row), items.getOrDefault(row.getId(), List.of())));
        });
  }

  @Override
  public CompletableFuture<Void> create(GraveContents contents) {
    return database
        .write(
            dsl -> {
              var grave = contents.grave();
              var pos = grave.pos();
              var inserted =
                  dsl.insertInto(QOL_GRAVE_CREATIONS)
                      .set(QOL_GRAVE_CREATIONS.ID, grave.id().toString())
                      .set(QOL_GRAVE_CREATIONS.OWNER, grave.owner().toString())
                      .onConflict(QOL_GRAVE_CREATIONS.ID)
                      .doNothing()
                      .execute();
              if (inserted == 1) {
                dsl.insertInto(QOL_GRAVES)
                    .set(QOL_GRAVES.ID, grave.id().toString())
                    .set(QOL_GRAVES.OWNER, grave.owner().toString())
                    .set(QOL_GRAVES.OWNER_NAME, grave.ownerName())
                    .set(QOL_GRAVES.WORLD, pos.world())
                    .set(QOL_GRAVES.X, pos.x())
                    .set(QOL_GRAVES.Y, pos.y())
                    .set(QOL_GRAVES.Z, pos.z())
                    .set(QOL_GRAVES.CREATED_AT, grave.createdAt().toEpochMilli())
                    .set(QOL_GRAVES.REPLACED_BLOCK, grave.replaced())
                    .execute();
                insertItems(dsl, grave.id(), contents.items());
              } else {
                var creation =
                    dsl.selectFrom(QOL_GRAVE_CREATIONS)
                        .where(QOL_GRAVE_CREATIONS.ID.eq(grave.id().toString()))
                        .fetchOne();
                if (creation == null || !creation.getOwner().equals(grave.owner().toString())) {
                  throw new IllegalStateException("grave handoff ID collides with another owner");
                }
                var stored =
                    dsl.selectFrom(QOL_GRAVES)
                        .where(QOL_GRAVES.ID.eq(grave.id().toString()))
                        .fetchOne();
                if (stored != null && !toGrave(stored).equals(grave)) {
                  throw new IllegalStateException("grave handoff ID collides with another grave");
                }
              }
              return true;
            })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<Claim> reserveTake(TakeRequest request) {
    return database.write(
        dsl -> {
          var grave = request.grave();
          var selected =
              dsl.selectFrom(QOL_GRAVE_ITEMS)
                  .where(
                      QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString()),
                      QOL_GRAVE_ITEMS.IDX.in(request.indexes()),
                      DSL.notExists(
                          DSL.selectOne()
                              .from(QOL_GRAVE_CLAIMS)
                              .where(
                                  QOL_GRAVE_CLAIMS.GRAVE.eq(QOL_GRAVE_ITEMS.GRAVE),
                                  QOL_GRAVE_CLAIMS.IDX.eq(QOL_GRAVE_ITEMS.IDX))),
                      DSL.notExists(
                          DSL.selectOne()
                              .from(QOL_GRAVE_DROPS)
                              .where(
                                  QOL_GRAVE_DROPS.GRAVE.eq(QOL_GRAVE_ITEMS.GRAVE),
                                  QOL_GRAVE_DROPS.IDX.eq(QOL_GRAVE_ITEMS.IDX))))
                  .orderBy(QOL_GRAVE_ITEMS.IDX)
                  .fetch(JooqGraveStore::toItem);
          for (var item : selected) {
            dsl.insertInto(QOL_GRAVE_CLAIMS)
                .set(QOL_GRAVE_CLAIMS.GRAVE, grave.toString())
                .set(QOL_GRAVE_CLAIMS.IDX, item.index())
                .set(QOL_GRAVE_CLAIMS.TOKEN, request.token().toString())
                .set(QOL_GRAVE_CLAIMS.TAKER, request.taker().toString())
                .set(QOL_GRAVE_CLAIMS.CREATED_AT, request.at().toEpochMilli())
                .execute();
          }
          var remaining =
              dsl.fetchCount(QOL_GRAVE_ITEMS, QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString()))
                  - selected.size();
          return new Claim(request.token(), grave, request.taker(), selected, remaining);
        });
  }

  @Override
  public CompletableFuture<Claim> reserveDrop(DropRequest request) {
    return database.write(
        dsl -> {
          var grave = request.grave();
          var index = request.index();
          var drop =
              dsl.selectFrom(QOL_GRAVE_DROPS)
                  .where(QOL_GRAVE_DROPS.GRAVE.eq(grave.toString()), QOL_GRAVE_DROPS.IDX.eq(index))
                  .fetchOne();
          var existing =
              dsl.selectFrom(QOL_GRAVE_CLAIMS)
                  .where(
                      QOL_GRAVE_CLAIMS.GRAVE.eq(grave.toString()), QOL_GRAVE_CLAIMS.IDX.eq(index))
                  .fetchOne();
          if (drop == null || existing != null) {
            return new Claim(request.token(), grave, request.taker(), List.of(), 0);
          }
          var item =
              dsl.selectFrom(QOL_GRAVE_ITEMS)
                  .where(QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString()), QOL_GRAVE_ITEMS.IDX.eq(index))
                  .fetchOne();
          if (item == null) {
            throw new IllegalStateException("drop has no grave item: " + grave + ":" + index);
          }
          dsl.insertInto(QOL_GRAVE_CLAIMS)
              .set(QOL_GRAVE_CLAIMS.GRAVE, grave.toString())
              .set(QOL_GRAVE_CLAIMS.IDX, index)
              .set(QOL_GRAVE_CLAIMS.TOKEN, request.token().toString())
              .set(QOL_GRAVE_CLAIMS.TAKER, request.taker().toString())
              .set(QOL_GRAVE_CLAIMS.CREATED_AT, request.at().toEpochMilli())
              .execute();
          var remaining =
              dsl.fetchCount(QOL_GRAVE_ITEMS, QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString())) - 1;
          return new Claim(
              request.token(), grave, request.taker(), List.of(toItem(item)), remaining);
        });
  }

  @Override
  public CompletableFuture<List<Claim>> pendingClaims() {
    return database.read(
        dsl -> {
          var groups = new LinkedHashMap<String, List<GraveItem>>();
          var headers = new HashMap<String, Claim>();
          dsl.selectFrom(QOL_GRAVE_CLAIMS)
              .orderBy(QOL_GRAVE_CLAIMS.CREATED_AT, QOL_GRAVE_CLAIMS.GRAVE, QOL_GRAVE_CLAIMS.IDX)
              .forEach(
                  row -> {
                    var token = row.getToken();
                    var item =
                        dsl.selectFrom(QOL_GRAVE_ITEMS)
                            .where(
                                QOL_GRAVE_ITEMS.GRAVE.eq(row.getGrave()),
                                QOL_GRAVE_ITEMS.IDX.eq(row.getIdx()))
                            .fetchOne();
                    if (item == null) {
                      throw new IllegalStateException("claim has no grave item: " + token);
                    }
                    groups.computeIfAbsent(token, ignored -> new ArrayList<>()).add(toItem(item));
                    headers.putIfAbsent(
                        token,
                        new Claim(
                            UUID.fromString(token),
                            UUID.fromString(row.getGrave()),
                            UUID.fromString(row.getTaker()),
                            List.of(),
                            0));
                  });
          return groups.entrySet().stream()
              .map(
                  entry -> {
                    var header = requireNonNull(headers.get(entry.getKey()));
                    return new Claim(
                        header.token(), header.grave(), header.taker(), entry.getValue(), 0);
                  })
              .toList();
        });
  }

  @Override
  public CompletableFuture<Taken> finishTake(UUID token, UUID taker) {
    return database.write(
        dsl -> {
          var claims =
              dsl.selectFrom(QOL_GRAVE_CLAIMS)
                  .where(
                      QOL_GRAVE_CLAIMS.TOKEN.eq(token.toString()),
                      QOL_GRAVE_CLAIMS.TAKER.eq(taker.toString()))
                  .orderBy(QOL_GRAVE_CLAIMS.IDX)
                  .fetch();
          if (claims.isEmpty()) {
            return new Taken(List.of(), 0);
          }
          var grave = claims.getFirst().getGrave();
          var items = new ArrayList<GraveItem>();
          for (var claim : claims) {
            if (!grave.equals(claim.getGrave())) {
              throw new IllegalStateException("claim token spans multiple graves: " + token);
            }
            var item =
                dsl.selectFrom(QOL_GRAVE_ITEMS)
                    .where(QOL_GRAVE_ITEMS.GRAVE.eq(grave), QOL_GRAVE_ITEMS.IDX.eq(claim.getIdx()))
                    .fetchOne();
            if (item == null) {
              throw new IllegalStateException("claim has no grave item: " + token);
            }
            items.add(toItem(item));
            dsl.deleteFrom(QOL_GRAVE_ITEMS)
                .where(QOL_GRAVE_ITEMS.GRAVE.eq(grave), QOL_GRAVE_ITEMS.IDX.eq(claim.getIdx()))
                .execute();
          }
          var remaining = dsl.fetchCount(QOL_GRAVE_ITEMS, QOL_GRAVE_ITEMS.GRAVE.eq(grave));
          return new Taken(items, remaining);
        });
  }

  @Override
  public CompletableFuture<Void> releaseTake(UUID token, UUID taker) {
    return database
        .write(
            dsl ->
                dsl.deleteFrom(QOL_GRAVE_CLAIMS)
                    .where(
                        QOL_GRAVE_CLAIMS.TOKEN.eq(token.toString()),
                        QOL_GRAVE_CLAIMS.TAKER.eq(taker.toString()))
                    .execute())
        .thenAccept(ignored -> {});
  }

  @Override
  public CompletableFuture<List<Drop>> beginExpiry(UUID grave, Notice notice) {
    return database.write(
        dsl -> {
          var row = dsl.selectFrom(QOL_GRAVES).where(QOL_GRAVES.ID.eq(grave.toString())).fetchOne();
          if (row == null) {
            throw new IllegalStateException("expired grave missing: " + grave);
          }
          var at = toGrave(row).pos();
          var items =
              dsl.selectFrom(QOL_GRAVE_ITEMS)
                  .where(QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString()))
                  .orderBy(QOL_GRAVE_ITEMS.IDX)
                  .fetch(JooqGraveStore::toItem);
          var first =
              dsl.insertInto(QOL_GRAVE_EXPIRIES)
                      .set(QOL_GRAVE_EXPIRIES.GRAVE, grave.toString())
                      .set(QOL_GRAVE_EXPIRIES.EXPIRED_AT, notice.at().toEpochMilli())
                      .onConflictDoNothing()
                      .execute()
                  == 1;
          for (var item : items) {
            insertDrop(dsl, grave, item.index(), new Projection(at, false));
          }
          dsl.update(QOL_GRAVE_DROPS)
              .set(QOL_GRAVE_DROPS.OWNER_ONLY, 0)
              .where(QOL_GRAVE_DROPS.GRAVE.eq(grave.toString()))
              .execute();
          if (first) {
            dsl.insertInto(QOL_NOTICES)
                .set(QOL_NOTICES.PLAYER, notice.player().toString())
                .set(QOL_NOTICES.MESSAGE, notice.message())
                .set(QOL_NOTICES.CREATED_AT, notice.at().toEpochMilli())
                .execute();
          }
          return drops(dsl, grave, null);
        });
  }

  @Override
  public CompletableFuture<List<Drop>> beginOverflow(
      UUID grave, Set<Integer> indexes, GravePos at) {
    return database.write(
        dsl -> {
          for (var index : indexes) {
            var exists =
                dsl.fetchExists(
                    dsl.selectOne()
                        .from(QOL_GRAVE_ITEMS)
                        .where(
                            QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString()),
                            QOL_GRAVE_ITEMS.IDX.eq(index)));
            if (!exists) {
              throw new IllegalStateException("overflow item missing: " + grave + ":" + index);
            }
            insertDrop(dsl, grave, index, new Projection(at, true));
          }
          return drops(dsl, grave, indexes);
        });
  }

  @Override
  public CompletableFuture<List<Drop>> pendingDrops() {
    return database.read(
        dsl ->
            dsl
                .selectDistinct(QOL_GRAVE_DROPS.GRAVE)
                .from(QOL_GRAVE_DROPS)
                .fetch(QOL_GRAVE_DROPS.GRAVE)
                .stream()
                .flatMap(grave -> drops(dsl, UUID.fromString(grave), null).stream())
                .toList());
  }

  @Override
  public CompletableFuture<Void> deleteEmpty(UUID grave) {
    return database
        .write(
            dsl -> {
              if (dsl.fetchCount(QOL_GRAVE_ITEMS, QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString()))
                  != 0) {
                throw new IllegalStateException("cannot delete grave while items remain: " + grave);
              }
              dsl.deleteFrom(QOL_GRAVES).where(QOL_GRAVES.ID.eq(grave.toString())).execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }

  private static void insertDrop(DSLContext dsl, UUID grave, int index, Projection projection) {
    var at = projection.pos();
    dsl.insertInto(QOL_GRAVE_DROPS)
        .set(QOL_GRAVE_DROPS.GRAVE, grave.toString())
        .set(QOL_GRAVE_DROPS.IDX, index)
        .set(QOL_GRAVE_DROPS.WORLD, at.world())
        .set(QOL_GRAVE_DROPS.X, at.x())
        .set(QOL_GRAVE_DROPS.Y, at.y())
        .set(QOL_GRAVE_DROPS.Z, at.z())
        .set(QOL_GRAVE_DROPS.OWNER_ONLY, projection.ownerOnly() ? 1 : 0)
        .onConflictDoNothing()
        .execute();
  }

  private static List<Drop> drops(DSLContext dsl, UUID grave, @Nullable Set<Integer> indexes) {
    var query = dsl.selectFrom(QOL_GRAVE_DROPS).where(QOL_GRAVE_DROPS.GRAVE.eq(grave.toString()));
    var rows =
        (indexes == null ? query : query.and(QOL_GRAVE_DROPS.IDX.in(indexes)))
            .orderBy(QOL_GRAVE_DROPS.IDX)
            .fetch();
    return rows.stream().map(row -> toDrop(dsl, row)).toList();
  }

  private static Drop toDrop(DSLContext dsl, QolGraveDropsRecord row) {
    var item =
        dsl.selectFrom(QOL_GRAVE_ITEMS)
            .where(QOL_GRAVE_ITEMS.GRAVE.eq(row.getGrave()), QOL_GRAVE_ITEMS.IDX.eq(row.getIdx()))
            .fetchOne();
    if (item == null) {
      throw new IllegalStateException("drop has no grave item: " + row.getGrave());
    }
    return new Drop(
        UUID.fromString(row.getGrave()),
        toItem(item),
        new GravePos(row.getWorld(), row.getX(), row.getY(), row.getZ()),
        row.getOwnerOnly() == 1);
  }

  @Override
  public CompletableFuture<Taken> take(UUID grave, Set<Integer> indexes) {
    return database.write(
        dsl -> {
          var inGrave = QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString());
          var taken =
              dsl.selectFrom(QOL_GRAVE_ITEMS)
                  .where(inGrave.and(QOL_GRAVE_ITEMS.IDX.in(indexes)))
                  .orderBy(QOL_GRAVE_ITEMS.IDX)
                  .fetch(JooqGraveStore::toItem);
          dsl.deleteFrom(QOL_GRAVE_ITEMS)
              .where(inGrave.and(QOL_GRAVE_ITEMS.IDX.in(indexes)))
              .execute();
          var remaining = dsl.fetchCount(QOL_GRAVE_ITEMS, inGrave);
          return new Taken(taken, remaining);
        });
  }

  @Override
  public CompletableFuture<Void> putBack(UUID grave, List<GraveItem> items) {
    return database
        .write(
            dsl -> {
              insertItems(dsl, grave, items);
              return true;
            })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<List<GraveItem>> delete(UUID grave) {
    return database.write(dsl -> remove(dsl, grave));
  }

  @Override
  public CompletableFuture<List<GraveItem>> expire(UUID grave, Optional<Notice> notice) {
    return database.write(
        dsl -> {
          var items = remove(dsl, grave);
          notice.ifPresent(
              note ->
                  dsl.insertInto(QOL_NOTICES)
                      .set(QOL_NOTICES.PLAYER, note.player().toString())
                      .set(QOL_NOTICES.MESSAGE, note.message())
                      .set(QOL_NOTICES.CREATED_AT, note.at().toEpochMilli())
                      .execute());
          return items;
        });
  }

  @Override
  public CompletableFuture<List<PendingNotice>> listNotices(UUID player) {
    return database.read(
        dsl ->
            dsl.selectFrom(QOL_NOTICES)
                .where(QOL_NOTICES.PLAYER.eq(player.toString()))
                .orderBy(QOL_NOTICES.ID)
                .fetch(row -> new PendingNotice(row.getId().longValue(), row.getMessage())));
  }

  @Override
  public CompletableFuture<Integer> acknowledgeNotices(UUID player, List<Long> ids) {
    if (ids.isEmpty()) {
      return CompletableFuture.completedFuture(0);
    }
    var storedIds = ids.stream().map(Math::toIntExact).toList();
    return database.write(
        dsl ->
            dsl.deleteFrom(QOL_NOTICES)
                .where(QOL_NOTICES.PLAYER.eq(player.toString()), QOL_NOTICES.ID.in(storedIds))
                .execute());
  }

  private static List<GraveItem> remove(DSLContext dsl, UUID grave) {
    var inGrave = QOL_GRAVE_ITEMS.GRAVE.eq(grave.toString());
    var items =
        dsl.selectFrom(QOL_GRAVE_ITEMS)
            .where(inGrave)
            .orderBy(QOL_GRAVE_ITEMS.IDX)
            .fetch(JooqGraveStore::toItem);
    dsl.deleteFrom(QOL_GRAVE_ITEMS).where(inGrave).execute();
    dsl.deleteFrom(QOL_GRAVES).where(QOL_GRAVES.ID.eq(grave.toString())).execute();
    return items;
  }

  private static void insertItems(DSLContext dsl, UUID grave, List<GraveItem> items) {
    for (var item : items) {
      dsl.insertInto(QOL_GRAVE_ITEMS)
          .set(QOL_GRAVE_ITEMS.GRAVE, grave.toString())
          .set(QOL_GRAVE_ITEMS.IDX, item.index())
          .set(QOL_GRAVE_ITEMS.SLOT, slotColumn(item.slot()))
          .set(QOL_GRAVE_ITEMS.ITEM, item.item().bytes())
          .execute();
    }
  }

  private static @Nullable Integer slotColumn(OptionalInt slot) {
    return slot.isPresent() ? slot.getAsInt() : null;
  }

  private static Grave toGrave(QolGravesRecord row) {
    return new Grave(
        UUID.fromString(row.getId()),
        UUID.fromString(row.getOwner()),
        row.getOwnerName(),
        new GravePos(row.getWorld(), row.getX(), row.getY(), row.getZ()),
        Instant.ofEpochMilli(row.getCreatedAt()),
        row.getReplacedBlock());
  }

  private static GraveItem toItem(QolGraveItemsRecord row) {
    @Nullable Integer slot = row.getSlot();
    return new GraveItem(
        row.getIdx(),
        slot == null ? OptionalInt.empty() : OptionalInt.of(slot),
        ItemBytes.of(row.getItem()));
  }
}
