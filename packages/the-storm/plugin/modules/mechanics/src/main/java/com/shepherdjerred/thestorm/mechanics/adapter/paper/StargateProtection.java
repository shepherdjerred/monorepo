package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.entity.EntityExplodeEvent;

/** Prevents ordinary edits and explosions from silently invalidating registered gates. */
final class StargateProtection implements Listener {
  private final StargateBook book;

  StargateProtection(StargateBook book) {
    this.book = book;
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void breakBlock(BlockBreakEvent event) {
    if (!occupied(event.getBlock())) return;
    event.setCancelled(true);
    event
        .getPlayer()
        .sendMessage(Component.text("Remove the Stargate before breaking its blocks."));
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void placeBlock(BlockPlaceEvent event) {
    if (occupied(event.getBlockPlaced())) {
      event.setCancelled(true);
      event
          .getPlayer()
          .sendMessage(Component.text("Remove the Stargate before changing its blocks."));
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void editSign(SignChangeEvent event) {
    if (book.committed().isEmpty()
        || book.committed()
            .flatMap(
                registry ->
                    registry.sign(
                        event.getBlock().getWorld().getUID(), PaperGrid.pos(event.getBlock())))
            .isPresent()) {
      event.setCancelled(true);
      event.getPlayer().sendMessage(Component.text("Remove the Stargate before editing its sign."));
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void explode(EntityExplodeEvent event) {
    event.blockList().removeIf(this::occupied);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void explode(BlockExplodeEvent event) {
    event.blockList().removeIf(this::occupied);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void extend(BlockPistonExtendEvent event) {
    if (moves(event.getBlocks(), event.getDirection())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void retract(BlockPistonRetractEvent event) {
    if (moves(event.getBlocks(), event.getDirection())) event.setCancelled(true);
  }

  private boolean moves(List<Block> blocks, org.bukkit.block.BlockFace direction) {
    return blocks.stream()
        .anyMatch(block -> occupied(block) || occupied(block.getRelative(direction)));
  }

  private boolean occupied(Block block) {
    if (book.committed().isEmpty()) {
      var material = block.getType();
      return material == Material.OBSIDIAN
          || material == Material.NETHER_PORTAL
          || Tag.ALL_SIGNS.isTagged(material)
          || Tag.BUTTONS.isTagged(material);
    }
    return book.committed()
        .flatMap(registry -> registry.occupied(block.getWorld().getUID(), PaperGrid.pos(block)))
        .isPresent();
  }
}
