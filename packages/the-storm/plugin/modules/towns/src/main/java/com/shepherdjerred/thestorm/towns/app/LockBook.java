package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockIndex;
import it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Every lock, in memory, by block. Hoppers ask it on every item they move, so a lookup is two hash
 * lookups with no allocation. Main thread only. It enforces its own invariant and throws when
 * handed data that breaks it: one lock per block.
 */
public final class LockBook implements LockIndex {

  private final Map<UUID, Lock> byId = new HashMap<>();
  private final Map<String, Long2ObjectOpenHashMap<Lock>> byBlock = new HashMap<>();
  private final Map<UUID, Integer> counts = new HashMap<>();

  /** Replaces everything with {@code locks}, as stored. */
  public void reload(List<Lock> locks) {
    byId.clear();
    byBlock.clear();
    counts.clear();
    locks.forEach(this::put);
  }

  /** The lock on block ({@code x}, {@code y}, {@code z}) of {@code world}, or null. */
  public @Nullable Lock at(String world, int x, int y, int z) {
    var blocks = byBlock.get(world);
    return blocks == null ? null : blocks.get(key(x, y, z));
  }

  @Override
  public Optional<Lock> lockAt(BlockPos block) {
    return Optional.ofNullable(at(block.world(), block.x(), block.y(), block.z()));
  }

  @Override
  public int countOf(UUID owner) {
    return counts.getOrDefault(owner, 0);
  }

  public Optional<Lock> byId(UUID id) {
    return Optional.ofNullable(byId.get(id));
  }

  public Collection<Lock> all() {
    return List.copyOf(byId.values());
  }

  /**
   * Adds {@code lock}, or replaces the lock with its id; its blocks must be free of other locks.
   */
  public void put(Lock lock) {
    for (var block : lock.blocks()) {
      var holder = at(block.world(), block.x(), block.y(), block.z());
      if (holder != null && !holder.id().equals(lock.id())) {
        throw new IllegalStateException(block + " is already locked by lock " + holder.id());
      }
    }
    remove(lock.id());
    byId.put(lock.id(), lock);
    for (var block : lock.blocks()) {
      byBlock
          .computeIfAbsent(block.world(), world -> new Long2ObjectOpenHashMap<>())
          .put(key(block.x(), block.y(), block.z()), lock);
    }
    if (!lock.restoration().imported()) {
      counts.merge(lock.owner(), 1, Integer::sum);
    }
  }

  /** Removes the lock with {@code id}, if any. */
  public void remove(UUID id) {
    var lock = byId.remove(id);
    if (lock == null) {
      return;
    }
    for (var block : lock.blocks()) {
      var blocks = byBlock.get(block.world());
      if (blocks != null) {
        blocks.remove(key(block.x(), block.y(), block.z()));
      }
    }
    if (lock.restoration().imported()) {
      return;
    }
    var count = counts.getOrDefault(lock.owner(), 0);
    if (count <= 1) {
      counts.remove(lock.owner());
    } else {
      counts.put(lock.owner(), count - 1);
    }
  }

  /** A packed key for a block, unique within one world (26 bits x and z, 12 bits y). */
  static long key(int x, int y, int z) {
    return ((long) (x & 0x3FF_FFFF) << 38) | ((long) (z & 0x3FF_FFFF) << 12) | (y & 0xFFFL);
  }
}
