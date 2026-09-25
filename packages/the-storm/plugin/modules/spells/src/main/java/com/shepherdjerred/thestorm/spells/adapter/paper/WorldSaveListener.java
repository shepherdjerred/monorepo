package com.shepherdjerred.thestorm.spells.adapter.paper;

import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.world.ChunkUnloadEvent;
import org.bukkit.event.world.WorldLoadEvent;
import org.bukkit.event.world.WorldSaveEvent;

/**
 * Ties temporary-block records to world saves: reverted records are forgotten once their world or
 * chunk is saved, and leftovers in a world that was not loaded at startup are reverted when it
 * loads.
 */
final class WorldSaveListener implements Listener {

  private final TemporaryBlocks blocks;

  WorldSaveListener(TemporaryBlocks blocks) {
    this.blocks = blocks;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onWorldSave(WorldSaveEvent event) {
    blocks.worldSaved(event.getWorld());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onChunkUnload(ChunkUnloadEvent event) {
    if (event.isSaveChunk()) {
      blocks.chunkSaved(event.getChunk());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onWorldLoad(WorldLoadEvent event) {
    blocks.worldLoaded(event.getWorld());
  }
}
