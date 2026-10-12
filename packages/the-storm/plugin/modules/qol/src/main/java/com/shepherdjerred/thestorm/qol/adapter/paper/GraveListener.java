package com.shepherdjerred.thestorm.qol.adapter.paper;

import org.bukkit.entity.ItemDisplay;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * Deaths make graves; clicks open or describe them; loading chunks restores their blocks; joining
 * players hear what happened to their graves while they were away.
 */
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

  /** After other plugins (the arena clears its drops at LOWEST) have changed the drops. */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onDeath(PlayerDeathEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getEntity())) return;
    deaths.died(event);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    safe.sample(event.getPlayer());
    deaths.recover(event.getPlayer());
    opening.recover(event.getPlayer());
    upkeep.deliverNotices(event.getPlayer());
    upkeep.expireNear(event.getPlayer());
    opening.nearby(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
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

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    if (event.hasChangedBlock()) {
      upkeep.expireNear(event.getPlayer());
      opening.nearby(event.getPlayer());
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onGroundDamage(EntityDamageEvent event) {
    if (event.getEntity() instanceof ItemDisplay display
        && GraveDropEntity.key(display).isPresent()) {
      event.setCancelled(true);
    }
  }
}
