package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.destroystokyo.paper.event.block.BlockDestroyEvent;
import java.util.List;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;

/**
 * Grave blocks cannot be broken, blown up, pushed, washed away or taken by mobs; only opening a
 * grave removes it. The items are safe in storage anyway; this keeps the marker where its owner
 * expects it and stops a head item from dropping.
 */
final class GraveShield implements Listener {

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    if (GraveBlocks.isGrave(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onEntityExplode(EntityExplodeEvent event) {
    event.blockList().removeIf(GraveBlocks::isGrave);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    event.blockList().removeIf(GraveBlocks::isGrave);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onPistonExtend(BlockPistonExtendEvent event) {
    if (anyGrave(event.getBlocks())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onPistonRetract(BlockPistonRetractEvent event) {
    if (anyGrave(event.getBlocks())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onFlow(BlockFromToEvent event) {
    if (GraveBlocks.isGrave(event.getToBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onEntityChange(EntityChangeBlockEvent event) {
    if (GraveBlocks.isGrave(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onDestroy(BlockDestroyEvent event) {
    if (GraveBlocks.isGrave(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onBurn(BlockBurnEvent event) {
    if (GraveBlocks.isGrave(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  private static boolean anyGrave(List<Block> blocks) {
    return blocks.stream().anyMatch(GraveBlocks::isGrave);
  }
}
