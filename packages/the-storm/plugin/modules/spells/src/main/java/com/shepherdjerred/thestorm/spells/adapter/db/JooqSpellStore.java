package com.shepherdjerred.thestorm.spells.adapter.db;

import static com.shepherdjerred.thestorm.spells.adapter.db.generated.Tables.SPELLS_FOCUS;
import static com.shepherdjerred.thestorm.spells.adapter.db.generated.Tables.SPELLS_MARK;
import static com.shepherdjerred.thestorm.spells.adapter.db.generated.Tables.SPELLS_TEMPORARY_BLOCK;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.spells.adapter.db.generated.tables.records.SpellsFocusRecord;
import com.shepherdjerred.thestorm.spells.adapter.db.generated.tables.records.SpellsMarkRecord;
import com.shepherdjerred.thestorm.spells.adapter.db.generated.tables.records.SpellsTemporaryBlockRecord;
import com.shepherdjerred.thestorm.spells.app.SpellStore;
import com.shepherdjerred.thestorm.spells.domain.FocusKey;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.Waypoint;
import com.shepherdjerred.thestorm.spells.domain.temporary.BlockKey;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.Condition;
import org.jooq.DSLContext;

/** The spells module's SQLite tables. Every write is one transaction on the writer thread. */
public final class JooqSpellStore implements SpellStore {

  private final StormDatabase database;

  public JooqSpellStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<TemporaryBlock>> temporaryBlocks() {
    return database.read(
        dsl ->
            dsl.selectFrom(SPELLS_TEMPORARY_BLOCK)
                .orderBy(SPELLS_TEMPORARY_BLOCK.REVERT_AT)
                .fetch(JooqSpellStore::toTemporaryBlock));
  }

  @Override
  public CompletableFuture<List<BlockKey>> saveTemporaryBlocks(List<TemporaryBlock> blocks) {
    var copy = List.copyOf(blocks);
    return database.write(
        dsl -> {
          var saved = new ArrayList<BlockKey>();
          for (var block : copy) {
            if (save(dsl, block) == 1) {
              saved.add(block.key());
            }
          }
          return List.copyOf(saved);
        });
  }

  /** Inserts {@code block}, or replaces a reverted record at its position; 0 if one is pending. */
  private static int save(DSLContext dsl, TemporaryBlock block) {
    var key = block.key();
    var revertAt = block.revertAt().toEpochMilli();
    return dsl.insertInto(SPELLS_TEMPORARY_BLOCK)
        .set(SPELLS_TEMPORARY_BLOCK.WORLD, key.world())
        .set(SPELLS_TEMPORARY_BLOCK.X, key.x())
        .set(SPELLS_TEMPORARY_BLOCK.Y, key.y())
        .set(SPELLS_TEMPORARY_BLOCK.Z, key.z())
        .set(SPELLS_TEMPORARY_BLOCK.ORIGINAL, block.original())
        .set(SPELLS_TEMPORARY_BLOCK.PLACED, block.placed())
        .set(SPELLS_TEMPORARY_BLOCK.REVERT_AT, revertAt)
        .set(SPELLS_TEMPORARY_BLOCK.REVERTED, false)
        .onConflict(
            SPELLS_TEMPORARY_BLOCK.WORLD,
            SPELLS_TEMPORARY_BLOCK.X,
            SPELLS_TEMPORARY_BLOCK.Y,
            SPELLS_TEMPORARY_BLOCK.Z)
        .doUpdate()
        .set(SPELLS_TEMPORARY_BLOCK.ORIGINAL, block.original())
        .set(SPELLS_TEMPORARY_BLOCK.PLACED, block.placed())
        .set(SPELLS_TEMPORARY_BLOCK.REVERT_AT, revertAt)
        .set(SPELLS_TEMPORARY_BLOCK.REVERTED, false)
        .where(SPELLS_TEMPORARY_BLOCK.REVERTED.isTrue())
        .execute();
  }

  @Override
  public CompletableFuture<Integer> deleteTemporaryBlocks(List<BlockKey> keys) {
    var copy = List.copyOf(keys);
    return database.write(
        dsl -> {
          var deleted = 0;
          for (var key : copy) {
            deleted += dsl.deleteFrom(SPELLS_TEMPORARY_BLOCK).where(at(key)).execute();
          }
          return deleted;
        });
  }

  @Override
  public CompletableFuture<Integer> markReverted(List<BlockKey> keys) {
    var copy = List.copyOf(keys);
    return database.write(
        dsl -> {
          var marked = 0;
          for (var key : copy) {
            marked +=
                dsl.update(SPELLS_TEMPORARY_BLOCK)
                    .set(SPELLS_TEMPORARY_BLOCK.REVERTED, true)
                    .where(at(key))
                    .execute();
          }
          return marked;
        });
  }

  @Override
  public CompletableFuture<Integer> forgetReverted(List<BlockKey> keys) {
    var copy = List.copyOf(keys);
    return database.write(
        dsl -> {
          var deleted = 0;
          for (var key : copy) {
            deleted +=
                dsl.deleteFrom(SPELLS_TEMPORARY_BLOCK)
                    .where(at(key), SPELLS_TEMPORARY_BLOCK.REVERTED.isTrue())
                    .execute();
          }
          return deleted;
        });
  }

  @Override
  public CompletableFuture<Integer> forgetReverted(String world) {
    return database.write(
        dsl ->
            dsl.deleteFrom(SPELLS_TEMPORARY_BLOCK)
                .where(
                    SPELLS_TEMPORARY_BLOCK.WORLD.eq(world),
                    SPELLS_TEMPORARY_BLOCK.REVERTED.isTrue())
                .execute());
  }

  private static Condition at(BlockKey key) {
    return SPELLS_TEMPORARY_BLOCK
        .WORLD
        .eq(key.world())
        .and(SPELLS_TEMPORARY_BLOCK.X.eq(key.x()))
        .and(SPELLS_TEMPORARY_BLOCK.Y.eq(key.y()))
        .and(SPELLS_TEMPORARY_BLOCK.Z.eq(key.z()));
  }

  @Override
  public CompletableFuture<Map<UUID, Waypoint>> marks() {
    return database.read(
        dsl -> {
          var marks = new HashMap<UUID, Waypoint>();
          for (var row : dsl.selectFrom(SPELLS_MARK).fetch()) {
            marks.put(UUID.fromString(row.getPlayerId()), toWaypoint(row));
          }
          return Map.copyOf(marks);
        });
  }

  @Override
  public CompletableFuture<Integer> saveMark(UUID player, Waypoint mark) {
    return database.write(
        dsl ->
            dsl.insertInto(SPELLS_MARK)
                .set(SPELLS_MARK.PLAYER_ID, player.toString())
                .set(SPELLS_MARK.WORLD, mark.world())
                .set(SPELLS_MARK.X, mark.x())
                .set(SPELLS_MARK.Y, mark.y())
                .set(SPELLS_MARK.Z, mark.z())
                .set(SPELLS_MARK.YAW, (double) mark.yaw())
                .set(SPELLS_MARK.PITCH, (double) mark.pitch())
                .onConflict(SPELLS_MARK.PLAYER_ID)
                .doUpdate()
                .set(SPELLS_MARK.WORLD, mark.world())
                .set(SPELLS_MARK.X, mark.x())
                .set(SPELLS_MARK.Y, mark.y())
                .set(SPELLS_MARK.Z, mark.z())
                .set(SPELLS_MARK.YAW, (double) mark.yaw())
                .set(SPELLS_MARK.PITCH, (double) mark.pitch())
                .execute());
  }

  @Override
  public CompletableFuture<Map<FocusKey, Long>> foci() {
    return database.read(
        dsl -> {
          var foci = new HashMap<FocusKey, Long>();
          for (var row : dsl.selectFrom(SPELLS_FOCUS).fetch()) {
            foci.put(toFocusKey(row), row.getGeneration());
          }
          return Map.copyOf(foci);
        });
  }

  @Override
  public CompletableFuture<Integer> saveFocus(FocusKey key, long generation) {
    return database.write(
        dsl ->
            dsl.insertInto(SPELLS_FOCUS)
                .set(SPELLS_FOCUS.PLAYER_ID, key.player().toString())
                .set(SPELLS_FOCUS.SPELL, key.spell().id())
                .set(SPELLS_FOCUS.GENERATION, generation)
                .onConflict(SPELLS_FOCUS.PLAYER_ID, SPELLS_FOCUS.SPELL)
                .doUpdate()
                .set(SPELLS_FOCUS.GENERATION, generation)
                .execute());
  }

  private static TemporaryBlock toTemporaryBlock(SpellsTemporaryBlockRecord row) {
    return new TemporaryBlock(
        new BlockKey(row.getWorld(), row.getX(), row.getY(), row.getZ()),
        row.getOriginal(),
        row.getPlaced(),
        Instant.ofEpochMilli(row.getRevertAt()));
  }

  private static Waypoint toWaypoint(SpellsMarkRecord row) {
    return new Waypoint(
        row.getWorld(),
        row.getX(),
        row.getY(),
        row.getZ(),
        row.getYaw().floatValue(),
        row.getPitch().floatValue());
  }

  private static FocusKey toFocusKey(SpellsFocusRecord row) {
    var spell =
        SpellKind.byId(row.getSpell())
            .orElseThrow(
                () ->
                    new IllegalStateException(
                        "stored focus names unknown spell " + row.getSpell()));
    return new FocusKey(UUID.fromString(row.getPlayerId()), spell);
  }
}
