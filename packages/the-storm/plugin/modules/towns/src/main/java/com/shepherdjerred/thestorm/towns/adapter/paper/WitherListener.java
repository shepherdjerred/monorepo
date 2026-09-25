package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.world.Neighbourhood;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Wither;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.jspecify.annotations.Nullable;

/**
 * Withers wander and destroy, so building one is limited: no wither skull may go on soul sand
 * within {@code radius} chunks of land the player has no say over, and a wither that is built
 * remembers its builder, who is then the culprit for everything it breaks. Vanilla spawns the
 * wither inside the skull's placement, so the placement tells the spawn who built it.
 */
final class WitherListener implements Listener {

  /** How close (in blocks) the wither spawns to the skull that completed it. */
  private static final double SPAWN_REACH = 4.0;

  private final Neighbourhood neighbourhood;
  private final Culprits culprits;
  private final int radius;
  private @Nullable Placement lastSkull;

  private final Server server;

  private record Placement(UUID builder, Location at, int tick) {}

  WitherListener(TownsState state, Culprits culprits, int radius, Server server) {
    this.neighbourhood = new Neighbourhood(state, state);
    this.culprits = culprits;
    this.radius = radius;
    this.server = server;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onSkull(BlockPlaceEvent event) {
    var block = event.getBlock();
    var type = block.getType();
    if (type != Material.WITHER_SKELETON_SKULL && type != Material.WITHER_SKELETON_WALL_SKULL) {
      return;
    }
    var player = event.getPlayer();
    var below = block.getRelative(BlockFace.DOWN).getType();
    var onSoul = below == Material.SOUL_SAND || below == Material.SOUL_SOIL;
    if (onSoul && nearForeignLand(player.getUniqueId(), block.getLocation())) {
      event.setCancelled(true);
      player.sendMessage(
          Notices.error(
              "You can't build a wither within " + radius + " chunks of land that isn't yours."));
      return;
    }
    lastSkull = new Placement(player.getUniqueId(), block.getLocation(), server.getCurrentTick());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onSpawn(CreatureSpawnEvent event) {
    if (event.getSpawnReason() != CreatureSpawnEvent.SpawnReason.BUILD_WITHER
        || !(event.getEntity() instanceof Wither wither)) {
      return;
    }
    var skull = lastSkull;
    lastSkull = null;
    var at = wither.getLocation();
    var builder =
        skull != null
                && skull.tick() == server.getCurrentTick()
                && Guard.world(skull.at()).equals(Guard.world(at))
                && skull.at().distance(at) <= SPAWN_REACH
            ? skull.builder()
            : Culprits.NOBODY;
    if (nearForeignLand(builder, at)) {
      event.setCancelled(true);
      return;
    }
    // A wither nobody built (a dispenser placed the last skull) is still remembered, as built by
    // nobody: nobody's member, so it may break nothing on anyone's land.
    culprits.rememberBuilder(wither, builder);
  }

  private boolean nearForeignLand(UUID player, Location at) {
    var center = ChunkPos.ofBlock(Guard.world(at).getName(), at.getBlockX(), at.getBlockZ());
    return neighbourhood.foreignLandNear(player, center, radius).isPresent();
  }
}
