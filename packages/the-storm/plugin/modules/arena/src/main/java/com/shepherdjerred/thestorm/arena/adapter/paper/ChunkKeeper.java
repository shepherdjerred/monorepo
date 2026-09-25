package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.ChunkPos;
import java.util.List;
import org.bukkit.World;
import org.bukkit.plugin.Plugin;

/** Keeps an arena's chunks loaded while a game runs, and only then. */
public interface ChunkKeeper {

  void keep(World world, List<ChunkPos> chunks);

  void release(World world, List<ChunkPos> chunks);

  /** Plugin chunk tickets: not saved with the world, so a crash never leaves chunks loaded. */
  static ChunkKeeper tickets(Plugin plugin) {
    return new ChunkKeeper() {
      @Override
      public void keep(World world, List<ChunkPos> chunks) {
        chunks.forEach(chunk -> world.addPluginChunkTicket(chunk.x(), chunk.z(), plugin));
      }

      @Override
      public void release(World world, List<ChunkPos> chunks) {
        chunks.forEach(chunk -> world.removePluginChunkTicket(chunk.x(), chunk.z(), plugin));
      }
    };
  }
}
