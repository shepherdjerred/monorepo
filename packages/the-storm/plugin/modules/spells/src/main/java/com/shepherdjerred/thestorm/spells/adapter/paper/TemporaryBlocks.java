package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.app.SpellStore;
import com.shepherdjerred.thestorm.spells.domain.temporary.BlockFacts;
import com.shepherdjerred.thestorm.spells.domain.temporary.BlockKey;
import com.shepherdjerred.thestorm.spells.domain.temporary.Replaceability;
import com.shepherdjerred.thestorm.spells.domain.temporary.RevertRule;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlock;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlockLedger;
import java.time.Duration;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.TileState;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Levelled;
import org.bukkit.block.data.type.Bed;
import org.bukkit.entity.LivingEntity;
import org.bukkit.util.BoundingBox;

/**
 * Places and reverts temporary blocks. Every placement is written to storage first and only reaches
 * the world once the write succeeds, so after a crash or restart every temporary block still has a
 * record, and the module reverts all of them when it starts. Blocks are set without physics, never
 * drop items, and replace only empty space, soft plants or (Freeze) still water. Main thread only.
 */
public final class TemporaryBlocks {

  private final TemporaryBlockLedger ledger = new TemporaryBlockLedger();
  private final SpellStore store;
  private final Server server;
  private final InstantSource time;
  private final Async async;

  TemporaryBlocks(SpellStore store, Server server, InstantSource time, Async async) {
    this.store = store;
    this.server = server;
    this.time = time;
    this.async = async;
  }

  /** The key of {@code block}'s position. */
  public static BlockKey key(Block block) {
    return new BlockKey(
        block.getWorld().getKey().asString(), block.getX(), block.getY(), block.getZ());
  }

  /** True when {@code block} is (or is about to be) a temporary block. */
  public boolean holds(Block block) {
    return ledger.holds(key(block));
  }

  /**
   * The blocks among {@code candidates} a temporary block may replace in {@code mode}: free of
   * other temporary blocks, allowed by {@link Replaceability} and, for solid placements, with no
   * creature standing in them.
   */
  public List<Block> eligible(List<Block> candidates, Replaceability.Mode mode) {
    return candidates.stream()
        .filter(block -> !holds(block))
        .filter(block -> Replaceability.canReplace(facts(block), mode))
        .filter(block -> mode == Replaceability.Mode.WATER || nobodyInside(block))
        .toList();
  }

  private static boolean nobodyInside(Block block) {
    return block
        .getWorld()
        .getNearbyEntities(BoundingBox.of(block), LivingEntity.class::isInstance)
        .isEmpty();
  }

  /** What {@link Replaceability} needs to know about {@code block}. */
  static BlockFacts facts(Block block) {
    var type = block.getType();
    var data = block.getBlockData();
    var blockEntity = block.getState(false) instanceof TileState;
    var multiBlock = data instanceof Bisected || data instanceof Bed;
    return new BlockFacts(kind(block, type, data), blockEntity, multiBlock);
  }

  private static BlockFacts.Kind kind(Block block, Material type, BlockData data) {
    if (type.isAir()) {
      return BlockFacts.Kind.AIR;
    }
    if (type == Material.WATER && data instanceof Levelled levelled && levelled.getLevel() == 0) {
      return BlockFacts.Kind.WATER_SOURCE;
    }
    if (Tag.REPLACEABLE.isTagged(type) && !block.isLiquid() && !Tag.FIRE.isTagged(type)) {
      return BlockFacts.Kind.SOFT;
    }
    return BlockFacts.Kind.OTHER;
  }

  /**
   * Turns {@code blocks} into {@code placed} for {@code duration}. The caller has filtered them
   * with {@link #eligible} and the protection check.
   */
  public void place(List<Block> blocks, BlockData placed, Duration duration) {
    var revertAt = time.instant().plus(duration);
    var records =
        blocks.stream()
            .map(
                block ->
                    new TemporaryBlock(
                        key(block),
                        block.getBlockData().getAsString(),
                        placed.getAsString(),
                        revertAt))
            .toList();
    var reserved = ledger.reserve(records);
    if (reserved.isEmpty()) {
      return;
    }
    async.onMain(
        store.saveTemporaryBlocks(reserved),
        "recording temporary blocks (none were placed)",
        saved -> apply(reserved, saved),
        failure -> reserved.forEach(block -> ledger.release(block.key())));
  }

  private void apply(List<TemporaryBlock> reserved, List<BlockKey> saved) {
    var stored = new HashSet<>(saved);
    var unused = new ArrayList<BlockKey>();
    for (var record : reserved) {
      var key = record.key();
      var block = blockAt(key);
      if (stored.contains(key)
          && block.isPresent()
          && block.get().getBlockData().getAsString().equals(record.original())) {
        block.get().setBlockData(server.createBlockData(record.placed()), false);
        ledger.placed(key);
      } else {
        // The world changed while the record was written, or the position already had a
        // pending revert from an earlier run: leave the world alone.
        ledger.release(key);
        if (stored.contains(key)) {
          unused.add(key);
        }
      }
    }
    forget(unused);
  }

  /**
   * Loads the reverts a previous run left and applies them now, then runs {@code then}. Casting
   * waits for this, so a new placement is never mistaken for a leftover.
   */
  void recover(Runnable then) {
    async.onMain(
        store.temporaryBlocks(),
        "loading pending temporary-block reverts",
        leftovers -> {
          revertLeftovers(leftovers);
          then.run();
        });
  }

  private void revertLeftovers(List<TemporaryBlock> leftovers) {
    var done = new ArrayList<BlockKey>();
    for (var leftover : leftovers) {
      if (revert(leftover)) {
        done.add(leftover.key());
      }
    }
    if (!leftovers.isEmpty()) {
      async
          .logger()
          .info(
              "Reverted {} temporary blocks left by the last run ({} wait for their world)",
              done.size(),
              leftovers.size() - done.size());
    }
    forget(done);
  }

  /** Reverts every block whose time is up. */
  void sweep() {
    var done = new ArrayList<BlockKey>();
    for (var due : ledger.due(time.instant())) {
      if (revert(due)) {
        ledger.release(due.key());
        done.add(due.key());
      }
    }
    forget(done);
  }

  /** Reverts every placed block now, at shutdown. */
  void revertAll() {
    var done = new ArrayList<BlockKey>();
    for (var placed : ledger.placed()) {
      if (revert(placed)) {
        ledger.release(placed.key());
        done.add(placed.key());
      }
    }
    forget(done);
  }

  /** Applies {@link RevertRule} to one record; false when its world is not loaded. */
  private boolean revert(TemporaryBlock record) {
    var block = blockAt(record.key());
    if (block.isEmpty()) {
      return false;
    }
    var current = block.get();
    var action =
        RevertRule.decide(record, current.getBlockData().getAsString(), current.getType().isAir());
    if (action == RevertRule.Action.RESTORE) {
      current.setBlockData(server.createBlockData(record.original()), false);
    }
    return true;
  }

  private Optional<Block> blockAt(BlockKey key) {
    var worldKey = NamespacedKey.fromString(key.world());
    World world = worldKey == null ? null : server.getWorld(worldKey);
    return world == null
        ? Optional.empty()
        : Optional.of(world.getBlockAt(key.x(), key.y(), key.z()));
  }

  private void forget(List<BlockKey> keys) {
    if (keys.isEmpty()) {
      return;
    }
    async.logFailure(store.deleteTemporaryBlocks(keys), "forgetting reverted temporary blocks");
  }
}
