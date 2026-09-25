package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.vehicle.VehicleMoveEvent;

/**
 * Cancels warmups on movement (on foot or in a vehicle) and damage, tracks safe spots and records
 * deaths for {@code /back}, and sends players without a bed or anchor back to spawn when they
 * respawn.
 */
final class TeleportListener implements Listener {

  private final PaperRuntime runtime;
  private final TeleportFlow flow;
  private final BackRecorder back;
  private final SafeTracker safe;
  private final Position spawn;

  /**
   * Where deaths are recorded and respawns go.
   *
   * @param back {@code /back} recording
   * @param safe last safe spots
   * @param spawn where bedless players respawn
   */
  record Places(BackRecorder back, SafeTracker safe, Position spawn) {}

  TeleportListener(PaperRuntime runtime, TeleportFlow flow, Places places) {
    this.runtime = runtime;
    this.flow = flow;
    this.back = places.back();
    this.safe = places.safe();
    this.spawn = places.spawn();
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    if (event.hasChangedBlock()) {
      flow.moved(event.getPlayer(), event.getTo());
      safe.moved(event.getPlayer(), event.getTo());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onVehicleMove(VehicleMoveEvent event) {
    for (var passenger : event.getVehicle().getPassengers()) {
      if (passenger instanceof Player player) {
        flow.moved(player, event.getTo());
      }
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDamage(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player player) {
      flow.damaged(player);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onDeath(PlayerDeathEvent event) {
    var player = event.getPlayer();
    safe.deathPoint(player)
        .ifPresent(point -> back.record(player.getUniqueId(), point, BackEntry.Cause.DEATH));
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onRespawn(PlayerRespawnEvent event) {
    if (event.getRespawnReason() != PlayerRespawnEvent.RespawnReason.DEATH
        || event.isBedSpawn()
        || event.isAnchorSpawn()) {
      return;
    }
    Positions.toLocation(runtime.server(), spawn).ifPresent(event::setRespawnLocation);
  }
}
