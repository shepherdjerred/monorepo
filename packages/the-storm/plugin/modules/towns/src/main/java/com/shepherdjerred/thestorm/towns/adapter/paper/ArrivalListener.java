package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerRespawnEvent;

/**
 * Logging in or respawning is arriving too: a player who may not teleport into a town (they logged
 * out there, or respawn at a bed or anchor there, after leaving it or being refused) is put on the
 * nearest loaded wilderness instead, or at a loaded, permitted world spawn.
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
      var safe = nearestWilderness(player, at);
      if (safe.isPresent()) {
        if (player.teleport(safe.get())) {
          player.sendMessage(
              Notices.info("You may not stay where you logged out, so you were moved."));
        } else {
          player.kick(Component.text("Could not move you out of protected land."));
        }
      } else {
        player.kick(Component.text("No loaded, permitted arrival location is available."));
      }
    }
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onRespawn(PlayerRespawnEvent event) {
    var player = event.getPlayer();
    var at = event.getRespawnLocation();
    if (!guard.permitsQuietly(player, ARRIVE, guard.land(at))) {
      var safe = nearestWilderness(player, at);
      if (safe.isPresent()) {
        event.setRespawnLocation(safe.get());
      } else {
        player.kick(Component.text("No loaded, permitted respawn location is available."));
      }
    }
  }

  /** Finds a safe loaded chunk without generating terrain in the arrival event. */
  Optional<Location> nearestWilderness(org.bukkit.entity.Player player, Location from) {
    var world = Guard.world(from);
    for (var ring = 1; ring <= SEARCH_CHUNKS; ring++) {
      var found = ringSpot(player, from, ring);
      if (found.isPresent()) {
        return found;
      }
    }
    var spawn = world.getSpawnLocation();
    return world.isChunkLoaded(spawn.getBlockX() >> 4, spawn.getBlockZ() >> 4)
            && safe(spawn)
            && guard.permitsQuietly(player, ARRIVE, guard.land(spawn))
        ? Optional.of(spawn)
        : Optional.empty();
  }

  private Optional<Location> ringSpot(org.bukkit.entity.Player player, Location from, int ring) {
    var world = Guard.world(from);
    var chunkX = from.getBlockX() >> 4;
    var chunkZ = from.getBlockZ() >> 4;
    for (var dx = -ring; dx <= ring; dx++) {
      for (var dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) != ring) {
          continue;
        }
        var candidate = candidate(player, world, chunkX + dx, chunkZ + dz);
        if (candidate.isPresent()) {
          return candidate;
        }
      }
    }
    return Optional.empty();
  }

  private Optional<Location> candidate(org.bukkit.entity.Player player, World world, int x, int z) {
    if (!world.isChunkLoaded(x, z)) {
      return Optional.empty();
    }
    var spot = surface(world, (x << 4) + 8, (z << 4) + 8);
    if (spot.isEmpty()) {
      return Optional.empty();
    }
    var land = guard.land(spot.get());
    return land instanceof Land.Wilderness && guard.permitsQuietly(player, ARRIVE, land)
        ? spot
        : Optional.empty();
  }

  private static Optional<Location> surface(World world, int x, int z) {
    var ground = world.getHighestBlockAt(x, z);
    if (ground.getY() + 2 >= world.getMaxHeight()) {
      return Optional.empty();
    }
    var spot = ground.getLocation().add(0.5, 1, 0.5);
    return safe(spot) ? Optional.of(spot) : Optional.empty();
  }

  private static boolean safe(Location spot) {
    var feet = spot.getBlock();
    var head = feet.getRelative(BlockFace.UP);
    var ground = feet.getRelative(BlockFace.DOWN);
    return safeGround(ground) && safeAir(feet) && safeAir(head);
  }

  private static boolean safeGround(Block ground) {
    var type = ground.getType();
    return type.isSolid()
        && type != Material.CACTUS
        && type != Material.MAGMA_BLOCK
        && type != Material.CAMPFIRE
        && type != Material.SOUL_CAMPFIRE;
  }

  private static boolean safeAir(Block block) {
    var type = block.getType();
    return block.isPassable()
        && !block.isLiquid()
        && type != Material.FIRE
        && type != Material.SOUL_FIRE
        && type != Material.POWDER_SNOW
        && type != Material.SWEET_BERRY_BUSH;
  }
}
