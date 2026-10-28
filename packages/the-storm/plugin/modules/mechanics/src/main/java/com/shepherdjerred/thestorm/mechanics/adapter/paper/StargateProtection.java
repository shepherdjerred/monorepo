package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.Player;
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
  private final ModuleContext context;
  private final StargatePortals portals;
  private final Protection protection;
  private final ChunkTickets tickets;

  StargateProtection(ModuleContext context, StargateBook book, StargatePortals portals) {
    this.context = context;
    this.book = book;
    this.portals = portals;
    this.protection = context.services().require(Protection.class);
    this.tickets = context.services().require(ChunkTickets.class);
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void breakBlock(BlockBreakEvent event) {
    if (!occupied(event.getBlock())) return;
    event.setCancelled(true);
    var player = event.getPlayer();
    if (!book.ready()) {
      player.sendMessage(Component.text("Stargates are loading or saving; try again."));
      return;
    }
    var block = event.getBlock();
    var gate = book.registry().occupied(block.getWorld().getUID(), PaperGrid.pos(block));
    if (gate.isEmpty()) return;
    var value = gate.orElseThrow();
    var pos = PaperGrid.pos(block);
    if (!value.frame().frameBlocks().contains(pos)
        && !value.sign().equals(pos)
        && !value.button().equals(pos)) return;
    if (!mayRemove(player, block, value)) {
      player.sendMessage(Component.text("You cannot remove this Stargate."));
      return;
    }
    if (!portals.closeForRemoval(value)) {
      player.sendMessage(Component.text("This Stargate could not be safely closed."));
      return;
    }
    removeAndBreak(player, block, value);
  }

  private boolean mayRemove(Player player, Block block, Stargate gate) {
    var cells = new java.util.ArrayList<>(gate.frame().frameBlocks());
    cells.addAll(gate.frame().interior());
    cells.add(gate.sign());
    cells.add(gate.button());
    return player.getUniqueId().equals(gate.ownerId())
        && new Guard(protection)
            .cells(player.getUniqueId(), new PaperGrid(block.getWorld()), cells)
            .isAllowed();
  }

  private void removeAndBreak(Player player, Block block, Stargate value) {
    var world = block.getWorld();
    var chunkX = block.getX() >> 4;
    var chunkZ = block.getZ() >> 4;
    var original = block.getBlockData().clone();
    tickets.hold(world, chunkX, chunkZ);
    try {
      var _ =
          book.deleteGate(value.id())
              .whenCompleteAsync(
                  (ignored, failure) -> {
                    try {
                      if (failure != null) {
                        context
                            .logger()
                            .error("Could not remove Stargate {}", value.name(), failure);
                        if (player.isOnline())
                          player.sendMessage(Component.text("Could not remove the Stargate."));
                      } else finishBreak(player, block, original);
                    } finally {
                      tickets.release(world, chunkX, chunkZ);
                    }
                  },
                  context.scheduler().mainThread());
    } catch (RuntimeException failure) {
      tickets.release(world, chunkX, chunkZ);
      throw failure;
    }
  }

  private void finishBreak(Player player, Block block, BlockData original) {
    if (!player.isOnline()) return;
    var location = player.getLocation();
    if (location == null
        || !player.getWorld().equals(block.getWorld())
        || location.distanceSquared(block.getLocation().add(0.5, 0.5, 0.5)) > 64
        || !block.getBlockData().equals(original)) {
      player.sendMessage(Component.text("Stargate removed; break the block when you return."));
    } else if (!player.breakBlock(block)) {
      player.sendMessage(Component.text("Stargate removed; you cannot break that block here."));
    }
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
