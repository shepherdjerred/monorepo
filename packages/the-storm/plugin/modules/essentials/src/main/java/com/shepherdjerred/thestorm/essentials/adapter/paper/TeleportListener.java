package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Duration;
import java.util.Objects;
import org.bukkit.Location;
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
  private final com.shepherdjerred.thestorm.essentials.app.RuntimeDestinations spawn;
  private final BedHomes beds;

  /**
   * Where deaths are recorded and respawns go.
   *
   * @param back {@code /back} recording
   * @param safe last safe spots
   * @param spawn where bedless players respawn
   * @param beds saved bed homes, used when the bed block is gone
   */
  record Places(
      BackRecorder back,
      SafeTracker safe,
      com.shepherdjerred.thestorm.essentials.app.RuntimeDestinations spawn,
      BedHomes beds) {}

  TeleportListener(PaperRuntime runtime, TeleportFlow flow, Places places) {
    this.runtime = runtime;
    this.flow = flow;
    this.back = places.back();
    this.safe = places.safe();
    this.spawn = places.spawn();
    this.beds = places.beds();
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
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getEntity())) return;
    var player = event.getPlayer();
    safe.deathPoint(player)
        .ifPresent(point -> back.record(player.getUniqueId(), point, BackEntry.Cause.DEATH));
  }

  /**
   * Runs before the towns arrival handler, which is {@link EventPriority#HIGH}. Towns is registered
   * first, so an equal priority would let this assignment replace a forbidden-town redirect.
   */
  @EventHandler(priority = EventPriority.NORMAL)
  void onRespawn(PlayerRespawnEvent event) {
    if (event.getRespawnReason() != PlayerRespawnEvent.RespawnReason.DEATH) return;
    var bed = beds.get(event.getPlayer().getUniqueId());
    if (bed.isPresent()) {
      placeBed(event, bed.orElseThrow());
      return;
    }
    if (event.isBedSpawn() || event.isAnchorSpawn()) return;
    Positions.toLocation(runtime.server(), spawn.spawn()).ifPresent(event::setRespawnLocation);
  }

  /** Uses the saved bed when its column is safe, otherwise the essentials spawn. */
  private void placeBed(PlayerRespawnEvent event, Position position) {
    var location = Positions.toLocation(runtime.server(), position);
    if (location.isEmpty()) return;
    var spot = location.orElseThrow();
    var world = spot.getWorld();
    if (world == null) return;
    if (!SafeLocations.isLoaded(spot)) {
      event.setRespawnLocation(spot);
      var player = event.getPlayer();
      runtime.onMain(
          world.getChunkAtAsync(spot),
          "loading a bed respawn",
          chunk -> adjustBed(player, spot, false));
      return;
    }
    var safe = SafeLocations.nearestSafe(spot);
    if (safe.isPresent()) {
      event.setRespawnLocation(safe.orElseThrow());
      return;
    }
    Positions.toLocation(runtime.server(), spawn.spawn()).ifPresent(event::setRespawnLocation);
  }

  private void adjustBed(Player player, Location spot, boolean retried) {
    if (!player.isOnline()) return;
    if (!stillAtBed(player, spot)) {
      if (!retried) {
        runtime
            .scheduler()
            .runOnMainThreadLater(Duration.ofMillis(50), () -> adjustBed(player, spot, true));
      }
      return;
    }
    var safe = SafeLocations.nearestSafe(spot);
    if (safe.isPresent()) {
      var landing = safe.orElseThrow();
      if (landing.getBlockY() != spot.getBlockY()) {
        var _ = player.teleportAsync(landing);
      }
      return;
    }
    Positions.toLocation(runtime.server(), spawn.spawn())
        .ifPresent(
            fallback -> {
              var _ = player.teleportAsync(fallback);
            });
  }

  private static boolean stillAtBed(Player player, Location spot) {
    var now = Positions.current(player);
    if (!Objects.equals(now.getWorld(), spot.getWorld())) return false;
    return now.distanceSquared(spot) <= 16;
  }
}
