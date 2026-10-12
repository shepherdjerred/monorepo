package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.BlockSpreadEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.ExplosionPrimeEvent;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.event.world.EntitiesLoadEvent;

/**
 * The sealed world's rules: nobody but staff changes blocks, nothing drops, nothing burns or
 * spreads, nothing spawns on its own, and the bomb entities never explode or take damage on their
 * own.
 */
final class WorldListener implements Listener {

  private final MatchRunner runner;
  private final PaperContext context;
  private final BombMarkers bombs;

  WorldListener(MatchRunner runner, PaperContext context, BombMarkers bombs) {
    this.runner = runner;
    this.context = context;
    this.bombs = bombs;
  }

  private boolean inWorld(Location location) {
    return location.getWorld().equals(context.world());
  }

  private boolean guarded(Location location, Player player) {
    return runner.memberOf(player.getUniqueId()).isPresent()
        || (inWorld(location) && !Staff.exempt(player));
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onBreak(BlockBreakEvent event) {
    if (guarded(event.getBlock().getLocation(), event.getPlayer())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onPlace(BlockPlaceEvent event) {
    if (guarded(event.getBlock().getLocation(), event.getPlayer())) {
      event.setCancelled(true);
    }
  }

  /** The match decides when a bomb goes off; its primed TNT never explodes on its own. */
  @EventHandler(ignoreCancelled = true)
  void onPrime(ExplosionPrimeEvent event) {
    if (bombs.bombOf(event.getEntity()).isPresent()) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onExplode(EntityExplodeEvent event) {
    if (bombs.bombOf(event.getEntity()).isPresent()) {
      event.setCancelled(true);
    } else if (inWorld(event.getLocation())) {
      event.blockList().clear();
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    if (inWorld(event.getBlock().getLocation())) {
      event.blockList().clear();
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onBombDamage(EntityDamageEvent event) {
    if (bombs.bombOf(event.getEntity()).isPresent()) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onIgnite(BlockIgniteEvent event) {
    if (inWorld(event.getBlock().getLocation())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onBurn(BlockBurnEvent event) {
    if (inWorld(event.getBlock().getLocation())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onSpread(BlockSpreadEvent event) {
    if (event.getSource().getType() == Material.FIRE && inWorld(event.getBlock().getLocation())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onChangeBlock(EntityChangeBlockEvent event) {
    if (inWorld(event.getBlock().getLocation())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onItemSpawn(ItemSpawnEvent event) {
    if (inWorld(event.getLocation())) {
      event.setCancelled(true);
    }
  }

  /** Nothing spawns in the world but what a plugin places. */
  @EventHandler(ignoreCancelled = true)
  void onSpawn(CreatureSpawnEvent event) {
    if (inWorld(event.getLocation())
        && event.getSpawnReason() != CreatureSpawnEvent.SpawnReason.CUSTOM) {
      event.setCancelled(true);
    }
  }

  /** Bomb entities loaded without a live match (after a crash) are removed. */
  @EventHandler
  void onEntitiesLoad(EntitiesLoadEvent event) {
    if (runner.live()) {
      return;
    }
    for (var entity : event.getEntities()) {
      if (bombs.bombOf(entity).isPresent()) {
        entity.remove();
      }
    }
  }
}
