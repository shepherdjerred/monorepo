package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerRespawnEvent;

/**
 * Logging in or respawning is arriving too: a player who may not teleport into a town (they logged
 * out there, or respawn at a bed or anchor there, after leaving it or being refused) is put on the
 * nearest wilderness instead, or at the world's spawn if none is near.
 */
final class ArrivalListener implements Listener {

  private static final Act ARRIVE = new Act(Action.TELEPORT_INTO, Subject.LOCATION);

  /** How many chunks out, in rings, to look for wilderness before falling back to spawn. */
  private static final int SEARCH_CHUNKS = 16;

  private final Guard guard;

  ArrivalListener(Guard guard) {
    this.guard = guard;
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    var at = Guard.position(player);
    if (!guard.permitsQuietly(player, ARRIVE, guard.land(at))) {
      player.teleport(nearestWilderness(at));
      player.sendMessage(Notices.info("You may not stay where you logged out, so you were moved."));
    }
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onRespawn(PlayerRespawnEvent event) {
    var player = event.getPlayer();
    var at = event.getRespawnLocation();
    if (!guard.permitsQuietly(player, ARRIVE, guard.land(at))) {
      event.setRespawnLocation(nearestWilderness(at));
    }
  }

  /** A safe spot on the nearest wilderness chunk, searched ring by ring; else the world spawn. */
  Location nearestWilderness(Location from) {
    var world = Guard.world(from);
    var chunkX = from.getBlockX() >> 4;
    var chunkZ = from.getBlockZ() >> 4;
    for (var ring = 1; ring <= SEARCH_CHUNKS; ring++) {
      for (var dx = -ring; dx <= ring; dx++) {
        for (var dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) != ring) {
            continue;
          }
          var spot = surface(world, ((chunkX + dx) << 4) + 8, ((chunkZ + dz) << 4) + 8);
          if (guard.land(spot) instanceof Land.Wilderness) {
            return spot;
          }
        }
      }
    }
    return world.getSpawnLocation();
  }

  private static Location surface(World world, int x, int z) {
    return world.getHighestBlockAt(x, z).getLocation().add(0.5, 1, 0.5);
  }
}
