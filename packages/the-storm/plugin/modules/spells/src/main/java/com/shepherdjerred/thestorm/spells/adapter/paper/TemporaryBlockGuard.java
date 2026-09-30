package com.shepherdjerred.thestorm.spells.adapter.paper;

import java.util.List;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;

/**
 * Keeps temporary blocks exactly as placed until they revert: nothing breaks, burns, melts, moves
 * or blows them up, so they never drop an item and their revert always finds them.
 */
final class TemporaryBlockGuard implements Listener {

  private final TemporaryBlocks blocks;

  TemporaryBlockGuard(TemporaryBlocks blocks) {
    this.blocks = blocks;
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    if (blocks.holds(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onBurn(BlockBurnEvent event) {
    if (blocks.holds(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onFade(BlockFadeEvent event) {
    if (blocks.holds(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onEntityChange(EntityChangeBlockEvent event) {
    if (blocks.holds(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onPistonPush(BlockPistonExtendEvent event) {
    if (anyHeld(event.getBlocks())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onPistonPull(BlockPistonRetractEvent event) {
    if (anyHeld(event.getBlocks())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    event.blockList().removeIf(blocks::holds);
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onEntityExplode(EntityExplodeEvent event) {
    event.blockList().removeIf(blocks::holds);
  }

  private boolean anyHeld(List<Block> moved) {
    return moved.stream().anyMatch(blocks::holds);
  }
}
