package com.shepherdjerred.thestorm.world.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.world.domain.CircleEdge;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.vehicle.VehicleMoveEvent;

/**
 * Keeps players inside circular borders. The native square border at the same diameter remains the
 * hard limit for chunks and entities; this stops players at the disc inside it.
 */
final class CircleBorders implements Listener {

  private static final Component EDGE =
      Component.text("You've reached the edge of the world.", NamedTextColor.GRAY);

  private final Map<String, CircleEdge> edges = new HashMap<>();
  private final Executor mainThread;
  private final Set<UUID> returning = new HashSet<>();

  CircleBorders(List<CircleEdge> edges, Executor mainThread) {
    for (var edge : edges) {
      this.edges.put(edge.world(), edge);
    }
    this.mainThread = mainThread;
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onMove(PlayerMoveEvent event) {
    if (!event.hasChangedBlock() || inside(event.getTo())) {
      return;
    }
    if (inside(event.getFrom())) {
      event.setCancelled(true);
      event.getPlayer().sendActionBar(EDGE);
      return;
    }
    returnInside(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onTeleport(PlayerTeleportEvent event) {
    if (!inside(event.getTo())) {
      event.setCancelled(true);
      event.getPlayer().sendActionBar(EDGE);
    }
  }

  @EventHandler
  public void onVehicleMove(VehicleMoveEvent event) {
    if (inside(event.getTo())) {
      return;
    }
    for (var passenger : event.getVehicle().getPassengers()) {
      if (passenger instanceof Player player) {
        event.getVehicle().removePassenger(player);
        returnInside(player);
      }
    }
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    if (!inside(requireNonNull(event.getPlayer().getLocation()))) {
      returnInside(event.getPlayer());
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void onRespawn(PlayerRespawnEvent event) {
    if (!inside(event.getRespawnLocation())) {
      event.setRespawnLocation(event.getRespawnLocation().getWorld().getSpawnLocation());
    }
  }

  private boolean inside(Location location) {
    var edge = edges.get(location.getWorld().getName());
    return edge == null || edge.contains(location.getX(), location.getZ());
  }

  /**
   * Returns invalid saved positions and vehicle passengers to the verified world spawn. A radial
   * surface projection is unsafe over Skylands/End void or the Nether roof. Load the spawn chunk
   * off-thread; leave a player alone if another teleport already brought them inside.
   */
  private void returnInside(Player player) {
    var at = requireNonNull(player.getLocation());
    var edge = edges.get(at.getWorld().getName());
    if (edge == null || !returning.add(player.getUniqueId())) {
      return;
    }
    var world = at.getWorld();
    var destination = world.getSpawnLocation();
    world
        .getChunkAtAsync(destination.getBlockX() >> 4, destination.getBlockZ() >> 4)
        .thenAcceptAsync(
            chunk -> {
              returning.remove(player.getUniqueId());
              if (!player.isOnline() || !player.getWorld().equals(world)) {
                return;
              }
              var now = requireNonNull(player.getLocation());
              if (inside(now)) {
                return;
              }
              destination.setYaw(now.getYaw());
              destination.setPitch(now.getPitch());
              player.teleport(destination);
              player.sendActionBar(EDGE);
            },
            mainThread)
        .exceptionally(
            failure -> {
              mainThread.execute(() -> returning.remove(player.getUniqueId()));
              return null;
            });
  }
}
