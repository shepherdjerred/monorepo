package com.shepherdjerred.thestorm.world.adapter.paper;

import com.shepherdjerred.thestorm.world.domain.CircleEdge;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.vehicle.VehicleMoveEvent;

/**
 * Keeps players inside circular borders. The native square border at the same diameter remains the
 * hard limit for chunks and entities; this stops players at the disc inside it.
 */
final class CircleBorders implements Listener {

  private static final double MARGIN = 2;
  private static final Component EDGE =
      Component.text("You've reached the edge of the world.", NamedTextColor.GRAY);

  private final Map<String, CircleEdge> edges = new HashMap<>();

  CircleBorders(List<CircleEdge> edges) {
    for (var edge : edges) {
      this.edges.put(edge.world(), edge);
    }
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
    if (!inside(java.util.Objects.requireNonNull(event.getPlayer().getLocation()))) {
      returnInside(event.getPlayer());
    }
  }

  private boolean inside(Location location) {
    var edge = edges.get(location.getWorld().getName());
    return edge == null || edge.contains(location.getX(), location.getZ());
  }

  private void returnInside(Player player) {
    var at = java.util.Objects.requireNonNull(player.getLocation());
    var edge = edges.get(at.getWorld().getName());
    if (edge == null) {
      return;
    }
    var column = edge.inward(at.getX(), at.getZ(), MARGIN);
    var world = at.getWorld();
    var y =
        world.getHighestBlockYAt((int) Math.floor(column.x()), (int) Math.floor(column.z())) + 1;
    player.teleport(new Location(world, column.x(), y, column.z(), at.getYaw(), at.getPitch()));
    player.sendActionBar(EDGE);
  }
}
