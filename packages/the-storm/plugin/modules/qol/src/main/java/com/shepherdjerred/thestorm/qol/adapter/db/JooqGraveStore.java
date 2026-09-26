package com.shepherdjerred.thestorm.qol.adapter.db;

import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVES;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_GRAVE_ITEMS;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_NOTICES;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
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
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;

/** {@link GraveStore} over {@code qol_graves} and {@code qol_grave_items}. */
public final class JooqGraveStore implements GraveStore {

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
              return true;
            })
        .thenAccept(done -> {});
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
  public CompletableFuture<List<String>> takeNotices(UUID player) {
    return database.write(
        dsl -> {
          var mine = QOL_NOTICES.PLAYER.eq(player.toString());
          var messages =
              dsl.select(QOL_NOTICES.MESSAGE)
                  .from(QOL_NOTICES)
                  .where(mine)
                  .orderBy(QOL_NOTICES.ID)
                  .fetch(QOL_NOTICES.MESSAGE);
          dsl.deleteFrom(QOL_NOTICES).where(mine).execute();
          return List.copyOf(messages);
        });
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
