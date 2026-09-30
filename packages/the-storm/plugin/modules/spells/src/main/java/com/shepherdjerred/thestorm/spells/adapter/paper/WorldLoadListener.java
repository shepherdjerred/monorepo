package com.shepherdjerred.thestorm.spells.adapter.paper;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.event.world.WorldLoadEvent;

/** Reverts leftover temporary blocks when their world loads after module startup. */
final class WorldLoadListener implements Listener {

  private final TemporaryBlocks blocks;

  WorldLoadListener(TemporaryBlocks blocks) {
    this.blocks = blocks;
  }

  @EventHandler
  void onWorldLoad(WorldLoadEvent event) {
    blocks.worldLoaded(event.getWorld());
  }

  @EventHandler
  void onChunkLoad(ChunkLoadEvent event) {
    blocks.chunkLoaded(event.getChunk());
  }
}
