package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * Moves a player to a plot home without loading the destination chunk on the server thread. The
 * player is told whether they arrived once that move finishes.
 */
final class PlotTeleport {

  private static final String LABEL = "Creative";

  /**
   * How a player is moved. Production uses {@link Player#teleportAsync}. Tests supply a synchronous
   * move because MockBukkit rejects {@code teleportAsync}.
   */
  @FunctionalInterface
  interface Arrival {
    CompletableFuture<Boolean> move(Player player, Location destination);
  }

  private final ModuleContext context;
  private final World world;
  private final PlotGrid grid;
  private final Arrival arrival;

  PlotTeleport(ModuleContext context, World world, PlotGrid grid, Arrival arrival) {
    this.context = context;
    this.world = world;
    this.grid = grid;
    this.arrival = arrival;
  }

  void teleport(Player player, PlotId id) {
    var home = grid.home(id);
    var moved =
        arrival
            .move(player, new Location(world, home.x(), home.y(), home.z()))
            .whenCompleteAsync(
                (landed, failure) -> arrived(player, id, landed, failure),
                context.scheduler().mainThread());
    var _ = moved;
  }

  private void arrived(
      Player player, PlotId id, @Nullable Boolean landed, @Nullable Throwable failure) {
    if (!player.isOnline()) {
      return;
    }
    if (failure != null || !Boolean.TRUE.equals(landed)) {
      if (failure != null) {
        context.logger().error("Creative teleport failed for {}", id.text(), failure);
      }
      player.sendMessage(
          HouseStyle.error(LABEL, Component.text("Could not teleport to " + id.text() + ".")));
      return;
    }
    player.sendMessage(
        HouseStyle.success(LABEL, Component.text("Teleported to " + id.text() + ".")));
  }
}
