package com.shepherdjerred.thestorm.core.world;

import java.util.HashMap;
import java.util.Map;
import org.bukkit.World;
import org.bukkit.plugin.Plugin;

/**
 * Reference-counted plugin chunk tickets. Paper's tickets belong to the whole plugin, so two
 * modules holding the same chunk would drop it for each other; every module takes and releases
 * tickets through this instead. Main thread only.
 */
public final class ChunkTickets {

  private record Key(String world, int x, int z) {}

  private final Plugin plugin;
  private final Map<Key, Integer> holds = new HashMap<>();

  public ChunkTickets(Plugin plugin) {
    this.plugin = plugin;
  }

  /** Keeps the chunk loaded until a matching {@link #release}. */
  public void hold(World world, int chunkX, int chunkZ) {
    var key = new Key(world.getName(), chunkX, chunkZ);
    var count = holds.merge(key, 1, Integer::sum);
    if (count == 1) {
      world.addPluginChunkTicket(chunkX, chunkZ, plugin);
    }
  }

  /** Releases one hold; the ticket is removed when the last holder releases. */
  public void release(World world, int chunkX, int chunkZ) {
    var key = new Key(world.getName(), chunkX, chunkZ);
    var count = holds.get(key);
    if (count == null) {
      throw new IllegalStateException("No hold on chunk " + key);
    }
    if (count == 1) {
      holds.remove(key);
      world.removePluginChunkTicket(chunkX, chunkZ, plugin);
    } else {
      holds.put(key, count - 1);
    }
  }

  /** How many holds exist on a chunk, for tests and diagnostics. */
  public int holds(World world, int chunkX, int chunkZ) {
    return holds.getOrDefault(new Key(world.getName(), chunkX, chunkZ), 0);
  }
}
