package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import com.shepherdjerred.thestorm.spells.app.SpellStore;
import com.shepherdjerred.thestorm.spells.domain.temporary.BlockFacts;
import com.shepherdjerred.thestorm.spells.domain.temporary.BlockKey;
import com.shepherdjerred.thestorm.spells.domain.temporary.Replaceability;
import com.shepherdjerred.thestorm.spells.domain.temporary.RevertRule;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlock;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlockLedger;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.BiFunction;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
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
import org.jspecify.annotations.Nullable;

/**
 * Places and reverts temporary blocks.
 *
 * <p>Every placement is written to storage first and only reaches the world once the write
 * succeeds. The chunk receives a recovery marker before its block changes. The marker and block are
 * serialized together; after a revert the database row can be removed without forcing a world save.
 * A crash leaves either the old temporary block with its marker or the restored block. Reverting is
 * idempotent ({@link RevertRule}).
 *
 * <p>Blocks are set without physics, never drop items, replace only empty space, soft plants or
 * (Freeze) still water, and never go where a creature or hanging entity is. Main thread only.
 */
public final class TemporaryBlocks {

  private static final Duration CLEANUP_INTERVAL = Duration.ofSeconds(30);
  private static final int CLEANUP_BATCH = 8;

  private final TemporaryBlockLedger ledger = new TemporaryBlockLedger();
  private final Map<String, List<TemporaryBlock>> waitingForWorld = new HashMap<>();
  private final Set<BlockKey> settled = new HashSet<>();
  private final Set<BlockKey> loading = new HashSet<>();
  private final Set<BlockKey> deleting = new HashSet<>();
  private final SpellStore store;
  private final Server server;
  private final InstantSource time;
  private final Async async;
  private final Protection protection;
  private final BlockChanges changes;
  private BiFunction<World, BlockKey, CompletableFuture<Block>> loader;
  private BiFunction<World, BlockKey, Optional<Block>> loadedBlock;
  private Instant nextCleanup;

  record Dependencies(
      Server server,
      InstantSource time,
      Async async,
      Protection protection,
      BlockChanges changes) {}

  TemporaryBlocks(SpellStore store, Dependencies runtime) {
    this.store = store;
    this.server = runtime.server();
    this.time = runtime.time();
    this.async = runtime.async();
    this.protection = runtime.protection();
    this.changes = runtime.changes();
    this.loader =
        (world, key) ->
            world
                .getChunkAtAsync(key.x() >> 4, key.z() >> 4, false)
                .thenApply(chunk -> blockIn(chunk, key));
    this.loadedBlock =
        (world, key) ->
            world.isChunkLoaded(key.x() >> 4, key.z() >> 4)
                ? Optional.of(blockIn(world.getChunkAt(key.x() >> 4, key.z() >> 4), key))
                : Optional.empty();
    this.nextCleanup = runtime.time().instant().plus(CLEANUP_INTERVAL);
  }

  TemporaryBlocks withLoader(BiFunction<World, BlockKey, CompletableFuture<Block>> replacement) {
    this.loader = replacement;
    this.loadedBlock = (world, key) -> Optional.of(world.getBlockAt(key.x(), key.y(), key.z()));
    return this;
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
        .filter(block -> !protection.isPreserved(block.getLocation()))
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
    place(blocks, placed, duration, ignored -> {});
  }

  /** Places blocks and reports whether at least one was durably recorded and applied. */
  public void place(
      List<Block> blocks, BlockData placed, Duration duration, Consumer<Boolean> completed) {
    place(blocks, placed, duration, new GuardedPlacement(() -> true, completed));
  }

  /** Checks that a delayed cast is still valid before the persisted blocks enter the world. */
  public record GuardedPlacement(BooleanSupplier stillValid, Consumer<Boolean> completed) {}

  /** Places only if {@code stillValid} holds after the storage write, before changing the world. */
  public void place(
      List<Block> blocks, BlockData placed, Duration duration, GuardedPlacement guard) {
    var revertAt = time.instant().plus(duration);
    var records =
        blocks.stream()
            .filter(block -> !protection.isPreserved(block.getLocation()))
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
      guard.completed().accept(false);
      return;
    }
    async.onMain(
        store.saveTemporaryBlocks(reserved),
        "recording temporary blocks (none were placed)",
        saved -> {
          try {
            guard.completed().accept(apply(reserved, saved, guard.stillValid().getAsBoolean()));
          } catch (RuntimeException failure) {
            async
                .logger()
                .error("Could not apply a recorded temporary block; shutting down", failure);
            server.shutdown();
          }
        },
        failure -> {
          reserved.forEach(block -> ledger.release(block.key()));
          guard.completed().accept(false);
        });
  }

  private boolean apply(List<TemporaryBlock> reserved, List<BlockKey> saved, boolean stillValid) {
    var stored = new HashSet<>(saved);
    var unused = new ArrayList<BlockKey>();
    var applied = false;
    for (var record : reserved) {
      var key = record.key();
      var block =
          stillValid
              ? blockAt(key).filter(found -> placeable(found, record))
              : Optional.<Block>empty();
      if (stored.contains(key) && block.isPresent()) {
        ChunkMarkers.put(block.get().getChunk(), record);
        changes.set("#storm-spells", block.get(), server.createBlockData(record.placed()), false);
        ledger.placed(key);
        applied = true;
        continue;
      }
      // The world changed while the record was written (someone stepped in, something was
      // built), or the position has a pending revert from an earlier run: leave the world alone.
      if (stored.contains(key)) {
        unused.add(key);
      }
    }
    if (!unused.isEmpty()) {
      async.onMain(
          store.deleteTemporaryBlocks(unused),
          "forgetting unplaced temporary blocks",
          ignored -> unused.forEach(ledger::release));
    }
    reserved.stream()
        .map(TemporaryBlock::key)
        .filter(key -> !stored.contains(key))
        .forEach(
            key ->
                async
                    .logger()
                    .error("Temporary-block position already has a recovery row: {}", key));
    return applied;
  }

  /** The block still shows the recorded original and nobody has moved into it. */
  private boolean placeable(Block block, TemporaryBlock record) {
    return !protection.isPreserved(block.getLocation())
        && block.getBlockData().getAsString().equals(record.original())
        && unoccupied(block);
  }

  /**
   * Reserves every record a previous run left, starts asynchronous chunk loads to revert it, then
   * runs {@code then}. Records in worlds that are not loaded wait for {@link #worldLoaded}; the
   * reserved positions keep new casts from overwriting any leftover while recovery is in flight.
   */
  void recover(Runnable then, Consumer<Throwable> failed) {
    async.onMain(
        store.temporaryBlocks(),
        "loading pending temporary-block reverts",
        leftovers -> {
          revertLeftovers(leftovers);
          for (var world : server.getWorlds()) {
            scanLoaded(world);
          }
          then.run();
        },
        failed);
  }

  private void revertLeftovers(List<TemporaryBlock> leftovers) {
    ledger.restore(leftovers);
    for (var leftover : leftovers) {
      var world = world(leftover.key());
      if (world == null) {
        waitingForWorld
            .computeIfAbsent(leftover.key().world(), ignored -> new ArrayList<>())
            .add(leftover);
      } else {
        load(world, leftover);
      }
    }
    if (!leftovers.isEmpty()) {
      async
          .logger()
          .info(
              "Recovering {} temporary blocks left by the last run ({} wait for their world)",
              leftovers.size(),
              waitingForWorld.values().stream().mapToInt(List::size).sum());
    }
  }

  /** Reverts the leftovers of a world that has just loaded. */
  void worldLoaded(World world) {
    var waiting = waitingForWorld.remove(world.getKey().asString());
    if (waiting != null) {
      revertLeftovers(waiting);
    }
    scanLoaded(world);
  }

  private void scanLoaded(World world) {
    for (var chunk : world.getLoadedChunks()) {
      chunkLoaded(chunk);
    }
  }

  /** Recovers marker-only blocks left by a crash after their SQLite row was deleted. */
  void chunkLoaded(Chunk chunk) {
    try {
      for (var marker : ChunkMarkers.entries(chunk)) {
        if (!ledger.holds(marker.key())) {
          if (!revert(marker, blockIn(chunk, marker.key()))) {
            ledger.restore(List.of(marker));
          }
        }
      }
    } catch (RuntimeException failure) {
      async.logger().error("Could not recover temporary-block markers; shutting down", failure);
      server.shutdown();
    }
  }

  /** Reverts every block whose time is up. */
  void sweep() {
    var now = time.instant();
    revertNow(ledger.due(now));
    if (!now.isBefore(nextCleanup)) {
      cleanup();
      nextCleanup = now.plus(CLEANUP_INTERVAL);
    }
  }

  /** Reverts every placed block now, at shutdown. */
  void revertAll() {
    revertNow(ledger.placed());
  }

  private void revertNow(List<TemporaryBlock> blocks) {
    var done = new ArrayList<TemporaryBlock>();
    for (var block : blocks) {
      if (!settled.contains(block.key()) && revert(block)) {
        settled.add(block.key());
        done.add(block);
      } else if (!settled.contains(block.key())) {
        var world = world(block.key());
        if (world != null) {
          load(world, block);
        }
      }
    }
    settle(done);
  }

  /** Deletes recovery rows after the chunk's block and marker have both been reverted in memory. */
  private void settle(List<TemporaryBlock> reverted) {
    if (reverted.isEmpty()) {
      return;
    }
    reverted.stream().map(TemporaryBlock::key).forEach(this::delete);
  }

  /** Retries failed row deletions; the chunk marker keeps crash recovery independent of SQLite. */
  private void cleanup() {
    for (var key : settled.stream().limit(CLEANUP_BATCH).toList()) {
      delete(key);
    }
  }

  private void delete(BlockKey key) {
    if (!deleting.add(key)) {
      return;
    }
    async.onMain(
        store.deleteTemporaryBlocks(List.of(key)),
        "forgetting reverted temporary block at " + key,
        ignored -> {
          deleting.remove(key);
          settled.remove(key);
          ledger.release(key);
        },
        failure -> deleting.remove(key));
  }

  private void load(World world, TemporaryBlock record) {
    var key = record.key();
    if (!loading.add(key)) {
      return;
    }
    async.onMain(
        loader.apply(world, key),
        "loading chunk for temporary-block recovery at " + key,
        block -> {
          loading.remove(key);
          if (revert(record, block)) {
            settled.add(key);
            settle(List.of(record));
          }
        },
        failure -> loading.remove(key));
  }

  private static Block blockIn(Chunk chunk, BlockKey key) {
    return chunk.getBlock(key.x() & 15, key.y(), key.z() & 15);
  }

  /** Applies {@link RevertRule} to one record; false when its world is not loaded. */
  private boolean revert(TemporaryBlock record) {
    var block = blockAt(record.key());
    if (block.isEmpty()) {
      return false;
    }
    return revert(record, block.get());
  }

  private boolean revert(TemporaryBlock record, Block current) {
    var action =
        RevertRule.decide(record, current.getBlockData().getAsString(), current.getType().isAir());
    if (action == RevertRule.Action.RESTORE) {
      if (protection.isPreserved(current.getLocation())) return false;
      changes.set(
          "#storm-spells-revert", current, server.createBlockData(record.original()), false);
    }
    ChunkMarkers.remove(current.getChunk(), record.key());
    return true;
  }

  private Optional<Block> blockAt(BlockKey key) {
    World world = world(key);
    return world == null ? Optional.empty() : loadedBlock.apply(world, key);
  }

  private @Nullable World world(BlockKey key) {
    var worldKey = NamespacedKey.fromString(key.world());
    return worldKey == null ? null : server.getWorld(worldKey);
  }
}
