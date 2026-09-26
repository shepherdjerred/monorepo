package com.shepherdjerred.thestorm.qol.adapter.paper;

import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Deaths make graves; clicks open or describe them; loading chunks restores their blocks. */
final class GraveListener implements Listener {

  private final GraveDeaths deaths;
  private final GraveOpening opening;
  private final GraveUpkeep upkeep;
  private final LastSafeSpots safe;

  GraveListener(GraveDeaths deaths, GraveOpening opening, GraveUpkeep upkeep, LastSafeSpots safe) {
    this.deaths = deaths;
    this.opening = opening;
    this.upkeep = upkeep;
    this.safe = safe;
  }

  /** After other plugins have added or removed drops. */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onDeath(PlayerDeathEvent event) {
    deaths.died(event);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    safe.sample(event.getPlayer());
  }

  /** Last, after a combat logout may have killed the player. */
  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    deaths.quit(event.getPlayer());
    safe.forget(event.getPlayer().getUniqueId());
  }

  /** Grave blocks are ours whatever else says about the block, so this ignores cancellation. */
  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null) {
      return;
    }
    var id = GraveBlocks.idAt(block);
    if (id.isEmpty()) {
      return;
    }
    event.setCancelled(true);
    if (event.getHand() != EquipmentSlot.HAND) {
      return;
    }
    if (event.getAction() == Action.RIGHT_CLICK_BLOCK) {
      opening.open(event.getPlayer(), block, id.orElseThrow());
    } else if (event.getAction() == Action.LEFT_CLICK_BLOCK) {
      opening.describe(event.getPlayer(), id.orElseThrow());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onChunkLoad(ChunkLoadEvent event) {
    upkeep.chunkLoaded(event.getChunk());
  }

  // While a grave is being saved its owner still holds the items, so none may leave the inventory.

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDrop(PlayerDropItemEvent event) {
    holdIfSaving(event.getPlayer(), event);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onClick(InventoryClickEvent event) {
    if (event.getWhoClicked() instanceof Player player) {
      holdIfSaving(player, event);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDrag(InventoryDragEvent event) {
    if (event.getWhoClicked() instanceof Player player) {
      holdIfSaving(player, event);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    holdIfSaving(event.getPlayer(), event);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onSwap(PlayerSwapHandItemsEvent event) {
    holdIfSaving(event.getPlayer(), event);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPickup(EntityPickupItemEvent event) {
    if (event.getEntity() instanceof Player player) {
      holdIfSaving(player, event);
    }
  }

  @EventHandler(priority = EventPriority.LOW)
  void onUse(PlayerInteractEvent event) {
    holdIfSaving(event.getPlayer(), event);
  }

  private void holdIfSaving(Player player, Cancellable event) {
    if (deaths.isPending(player.getUniqueId())) {
      event.setCancelled(true);
    }
  }
}
