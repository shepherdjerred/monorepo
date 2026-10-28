package com.shepherdjerred.thestorm.qol.adapter.db;

import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_SORT_PLAYER;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.app.store.SortStore;
import com.shepherdjerred.thestorm.qol.domain.sort.SortSwitches;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.jooq.DSLContext;

/** Per-player sort switches in SQLite. */
public final class JooqSortStore implements SortStore {

  private final StormDatabase database;

  public JooqSortStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Map<UUID, SortSwitches>> loadAll() {
    return database.read(
        dsl -> {
          var loaded = new HashMap<UUID, SortSwitches>();
          for (var row : dsl.selectFrom(QOL_SORT_PLAYER)) {
            loaded.put(
                UUID.fromString(row.getPlayer()),
                new SortSwitches(
                    on(row.getContainers()),
                    on(row.getInventory()),
                    on(row.getMiddleClick()),
                    on(row.getShiftClick()),
                    on(row.getDoubleClick()),
                    on(row.getShiftRightClick()),
                    on(row.getDump()),
                    on(row.getTake()),
                    on(row.getLeftClickBlock())));
          }
          return loaded;
        });
  }

  @Override
  public CompletableFuture<Void> save(UUID player, SortSwitches switches) {
    return done(
        dsl -> {
          dsl.deleteFrom(QOL_SORT_PLAYER)
              .where(QOL_SORT_PLAYER.PLAYER.eq(player.toString()))
              .execute();
          dsl.insertInto(QOL_SORT_PLAYER)
              .set(QOL_SORT_PLAYER.PLAYER, player.toString())
              .set(QOL_SORT_PLAYER.CONTAINERS, bit(switches.containers()))
              .set(QOL_SORT_PLAYER.INVENTORY, bit(switches.inventory()))
              .set(QOL_SORT_PLAYER.MIDDLE_CLICK, bit(switches.middleClick()))
              .set(QOL_SORT_PLAYER.SHIFT_CLICK, bit(switches.shiftClick()))
              .set(QOL_SORT_PLAYER.DOUBLE_CLICK, bit(switches.doubleClick()))
              .set(QOL_SORT_PLAYER.SHIFT_RIGHT_CLICK, bit(switches.shiftRightClick()))
              .set(QOL_SORT_PLAYER.DUMP, bit(switches.dump()))
              .set(QOL_SORT_PLAYER.TAKE, bit(switches.take()))
              .set(QOL_SORT_PLAYER.LEFT_CLICK_BLOCK, bit(switches.leftClickBlock()))
              .execute();
        });
  }

  private CompletableFuture<Void> done(Consumer<DSLContext> work) {
    return database
        .write(
            dsl -> {
              work.accept(dsl);
              return Boolean.TRUE;
            })
        .thenAccept(ignored -> {});
  }

  private static boolean on(Integer bit) {
    return bit != null && bit != 0;
  }

  private static int bit(boolean on) {
    return on ? 1 : 0;
  }
}
