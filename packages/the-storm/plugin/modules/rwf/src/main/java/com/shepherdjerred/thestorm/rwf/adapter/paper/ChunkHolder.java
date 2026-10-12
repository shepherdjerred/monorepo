package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import org.bukkit.World;

/** Keeps a map's chunks loaded for as long as the module runs. */
public interface ChunkHolder {

  void hold(World world, int chunkX, int chunkZ);

  void release(World world, int chunkX, int chunkZ);

  /**
   * The plugin's shared, reference-counted chunk tickets: not saved with the world, so a crash
   * never leaves chunks loaded, and safe alongside other modules holding the same chunks.
   */
  static ChunkHolder shared(ChunkTickets tickets) {
    return new ChunkHolder() {
      @Override
      public void hold(World world, int chunkX, int chunkZ) {
        tickets.hold(world, chunkX, chunkZ);
      }

      @Override
      public void release(World world, int chunkX, int chunkZ) {
        tickets.release(world, chunkX, chunkZ);
      }
    };
  }
}
