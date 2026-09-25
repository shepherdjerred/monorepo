package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.ChunkPos;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import java.util.List;
import org.bukkit.World;

/** Keeps an arena's chunks loaded while a game runs, and only then. */
public interface ChunkKeeper {

  void keep(World world, List<ChunkPos> chunks);

  void release(World world, List<ChunkPos> chunks);

  /**
   * The plugin's shared, reference-counted chunk tickets: not saved with the world, so a crash
   * never leaves chunks loaded, and safe alongside other modules holding the same chunks.
   */
  static ChunkKeeper shared(ChunkTickets tickets) {
    return new ChunkKeeper() {
      @Override
      public void keep(World world, List<ChunkPos> chunks) {
        chunks.forEach(chunk -> tickets.hold(world, chunk.x(), chunk.z()));
      }

      @Override
      public void release(World world, List<ChunkPos> chunks) {
        chunks.forEach(chunk -> tickets.release(world, chunk.x(), chunk.z()));
      }
    };
  }
}
