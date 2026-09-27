package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import io.papermc.paper.event.entity.ItemTransportingEntityValidateTargetEvent;
import io.papermc.paper.event.player.PlayerOpenSignEvent;
import java.util.List;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryPickupItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.Inventory;

/** Protects possible sign shops while the database registry is still loading or has failed. */
final class ShopReadinessListener implements Listener {

  private static final List<BlockFace> SIGN_NEIGHBORS =
      List.of(BlockFace.UP, BlockFace.NORTH, BlockFace.EAST, BlockFace.SOUTH, BlockFace.WEST);

  private final ShopRegistry registry;
  private final Set<Material> containers;

  ShopReadinessListener(ShopRegistry registry, Set<Material> containers) {
    this.registry = registry;
    this.containers = containers;
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onClick(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (blocked() && block != null && candidate(block)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onOpen(InventoryOpenEvent event) {
    if (blocked() && container(event.getInventory())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onInventoryClick(InventoryClickEvent event) {
    if (blocked() && container(event.getView().getTopInventory())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onInventoryDrag(InventoryDragEvent event) {
    if (blocked() && container(event.getView().getTopInventory())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onMove(InventoryMoveItemEvent event) {
    if (blocked() && (container(event.getSource()) || container(event.getDestination()))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onPickup(InventoryPickupItemEvent event) {
    if (blocked() && container(event.getInventory())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    if (blocked() && candidateOrSupport(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    if (blocked() && candidate(event.getBlockPlaced())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onSignChange(SignChangeEvent event) {
    if (blocked()) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onOpenSign(PlayerOpenSignEvent event) {
    if (blocked()) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onGolemTarget(ItemTransportingEntityValidateTargetEvent event) {
    if (blocked() && candidate(event.getBlock())) {
      event.setAllowed(false);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    if (blocked()) {
      event.blockList().removeIf(this::candidateOrSupport);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onEntityExplode(EntityExplodeEvent event) {
    if (blocked()) {
      event.blockList().removeIf(this::candidateOrSupport);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onPistonExtend(BlockPistonExtendEvent event) {
    if (blocked() && event.getBlocks().stream().anyMatch(this::candidateOrSupport)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onPistonRetract(BlockPistonRetractEvent event) {
    if (blocked() && event.getBlocks().stream().anyMatch(this::candidateOrSupport)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onBurn(BlockBurnEvent event) {
    if (blocked() && candidateOrSupport(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onEntityChange(EntityChangeBlockEvent event) {
    if (blocked() && candidateOrSupport(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  private boolean blocked() {
    return !registry.isReady();
  }

  private boolean container(Inventory inventory) {
    var location = inventory.getLocation();
    return location != null && containers.contains(location.getBlock().getType());
  }

  private boolean candidate(Block block) {
    return containers.contains(block.getType()) || block.getState(false) instanceof Sign;
  }

  private boolean candidateOrSupport(Block block) {
    if (candidate(block)) {
      return true;
    }
    for (var face : SIGN_NEIGHBORS) {
      var neighbor = block.getRelative(face);
      if (!neighbor.getWorld().isChunkLoaded(neighbor.getX() >> 4, neighbor.getZ() >> 4)) {
        return true;
      }
      if (neighbor.getState(false) instanceof Sign
          && ShopBlocks.supportOf(neighbor).filter(block::equals).isPresent()) {
        return true;
      }
    }
    return false;
  }
}
