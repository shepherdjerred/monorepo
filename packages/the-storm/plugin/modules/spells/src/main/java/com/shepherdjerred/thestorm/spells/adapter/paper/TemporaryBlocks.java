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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.bukkit.Chunk;
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
import org.bukkit.entity.Entity;
import org.bukkit.entity.Hanging;
import org.bukkit.entity.LivingEntity;
import org.bukkit.util.BoundingBox;

/**
 * Places and reverts temporary blocks.
 *
 * <p>Every placement is written to storage first and only reaches the world once the write
 * succeeds. A revert only marks its record reverted; the record is forgotten once the world or the
 * block's chunk has been saved. So after a crash, whether or not the world on disk still shows the
 * temporary block, a record remains, and the module reverts every remaining record when it starts
 * (and when a world that was not loaded then loads). Reverting is idempotent ({@link RevertRule}).
 *
 * <p>Blocks are set without physics, never drop items, replace only empty space, soft plants or
 * (Freeze) still water, and never go where a creature or hanging entity is. Main thread only.
 */
public final class TemporaryBlocks {

  private final TemporaryBlockLedger ledger = new TemporaryBlockLedger();
  private final Map<String, List<TemporaryBlock>> waitingForWorld = new HashMap<>();
  private final Map<String, Set<BlockKey>> awaitingSave = new HashMap<>();
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
   * other temporary blocks, allowed by {@link Replaceability}, and with no creature or hanging
   * entity (painting, item frame) in them.
   */
  public List<Block> eligible(List<Block> candidates, Replaceability.Mode mode) {
    return candidates.stream()
        .filter(block -> !holds(block))
        .filter(block -> Replaceability.canReplace(facts(block), mode))
        .filter(TemporaryBlocks::unoccupied)
        .toList();
  }

  /** True when no creature or hanging entity overlaps {@code block}. */
  static boolean unoccupied(Block block) {
    return block
        .getWorld()
        .getNearbyEntities(BoundingBox.of(block), TemporaryBlocks::occupies)
        .isEmpty();
  }

  private static boolean occupies(Entity entity) {
    return entity instanceof LivingEntity || entity instanceof Hanging;
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
   * with {@link #eligible} and the protection check; each is checked again when it is placed.
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
      var block = blockAt(key).filter(found -> placeable(found, record));
      if (stored.contains(key) && block.isPresent()) {
        block.get().setBlockData(server.createBlockData(record.placed()), false);
        ledger.placed(key);
        continue;
      }
      // The world changed while the record was written (someone stepped in, something was
      // built), or the position has a pending revert from an earlier run: leave the world alone.
      ledger.release(key);
      if (stored.contains(key)) {
        unused.add(key);
      }
    }
    if (!unused.isEmpty()) {
      async.logFailure(store.deleteTemporaryBlocks(unused), "forgetting unplaced temporary blocks");
    }
  }

  /** The block still shows the recorded original and nobody has moved into it. */
  private static boolean placeable(Block block, TemporaryBlock record) {
    return block.getBlockData().getAsString().equals(record.original()) && unoccupied(block);
  }

  /**
   * Reverts every record a previous run left (records in worlds that are not loaded wait for {@link
   * #worldLoaded}), then runs {@code then}. Casting waits for this, so a new placement is never
   * mistaken for a leftover.
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
    var done = new ArrayList<TemporaryBlock>();
    for (var leftover : leftovers) {
      if (revert(leftover)) {
        done.add(leftover);
      } else {
        waitingForWorld
            .computeIfAbsent(leftover.key().world(), world -> new ArrayList<>())
            .add(leftover);
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
    settle(done);
  }

  /** Reverts the leftovers of a world that has just loaded. */
  void worldLoaded(World world) {
    var waiting = waitingForWorld.remove(world.getKey().asString());
    if (waiting != null) {
      revertLeftovers(waiting);
    }
  }

  /** Reverts every block whose time is up. */
  void sweep() {
    revertNow(ledger.due(time.instant()));
  }

  /** Reverts every placed block now, at shutdown. */
  void revertAll() {
    revertNow(ledger.placed());
  }

  private void revertNow(List<TemporaryBlock> blocks) {
    var done = new ArrayList<TemporaryBlock>();
    for (var block : blocks) {
      if (revert(block)) {
        ledger.release(block.key());
        done.add(block);
      }
    }
    settle(done);
  }

  /** {@code world} was saved: its reverted records are no longer needed. */
  void worldSaved(World world) {
    var worldKey = world.getKey().asString();
    var keys = awaitingSave.remove(worldKey);
    if (keys != null && !keys.isEmpty()) {
      async.logFailure(store.forgetReverted(worldKey), "forgetting reverted temporary blocks");
    }
  }

  /** {@code chunk} was unloaded and saved: its reverted records are no longer needed. */
  void chunkSaved(Chunk chunk) {
    var keys = awaitingSave.get(chunk.getWorld().getKey().asString());
    if (keys == null) {
      return;
    }
    var inChunk =
        keys.stream()
            .filter(key -> key.x() >> 4 == chunk.getX() && key.z() >> 4 == chunk.getZ())
            .toList();
    if (!inChunk.isEmpty()) {
      inChunk.forEach(keys::remove);
      async.logFailure(store.forgetReverted(inChunk), "forgetting reverted temporary blocks");
    }
  }

  /** Records reverts, to be forgotten when the world or chunk is saved. */
  private void settle(List<TemporaryBlock> reverted) {
    if (reverted.isEmpty()) {
      return;
    }
    var keys = reverted.stream().map(TemporaryBlock::key).toList();
    for (var key : keys) {
      awaitingSave.computeIfAbsent(key.world(), world -> new HashSet<>()).add(key);
    }
    async.logFailure(store.markReverted(keys), "marking temporary blocks reverted");
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
}
