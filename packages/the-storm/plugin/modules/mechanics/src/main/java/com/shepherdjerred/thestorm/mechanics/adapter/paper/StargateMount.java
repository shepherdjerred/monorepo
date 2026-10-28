package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.AbstractHorse;
import org.bukkit.entity.Boat;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Minecart;
import org.bukkit.entity.Pig;
import org.bukkit.entity.Player;
import org.bukkit.entity.Strider;

/** Moves a single rider with their supported vehicle after player travel checks have passed. */
final class StargateMount {
  private static final Set<Material> HAZARDS =
      Set.of(
          Material.LAVA,
          Material.FIRE,
          Material.SOUL_FIRE,
          Material.MAGMA_BLOCK,
          Material.CACTUS,
          Material.SWEET_BERRY_BUSH,
          Material.POWDER_SNOW,
          Material.WITHER_ROSE,
          Material.POINTED_DRIPSTONE,
          Material.CAMPFIRE,
          Material.SOUL_CAMPFIRE,
          Material.NETHER_PORTAL,
          Material.END_PORTAL,
          Material.END_GATEWAY);

  private StargateMount() {}

  private record LandingCheck(
      Player player, Protection protection, org.bukkit.World world, int minY, int maxY) {}

  static boolean supported(Entity entity) {
    return entity instanceof Boat
        || entity instanceof Minecart
        || entity instanceof AbstractHorse
        || entity instanceof Pig
        || entity instanceof Strider;
  }

  /** Find a portal block intersecting the vehicle's footprint at its reported position. */
  static java.util.Optional<Location> touchingPortal(
      Entity entity, Location location, java.util.function.Predicate<Location> isPortal) {
    var radius = entity.getWidth() / 2;
    var minX = (int) Math.floor(location.getX() - radius);
    var maxX = (int) Math.floor(location.getX() + radius);
    var minZ = (int) Math.floor(location.getZ() - radius);
    var maxZ = (int) Math.floor(location.getZ() + radius);
    var minY = (int) Math.floor(location.getY());
    var maxY = (int) Math.floor(location.getY() + entity.getHeight());
    for (var x = minX; x <= maxX; x++) {
      for (var z = minZ; z <= maxZ; z++) {
        for (var y = minY; y <= maxY; y++) {
          var candidate = new Location(location.getWorld(), x + 0.5, y, z + 0.5);
          if (isPortal.test(candidate)) return java.util.Optional.of(candidate);
        }
      }
    }
    return java.util.Optional.empty();
  }

  static TeleportTravel.BiMove transport(
      @org.jspecify.annotations.Nullable Entity mount, Protection protection) {
    if (mount == null)
      return (player, destination) ->
          player.getVehicle() == null
              ? player.teleportAsync(destination)
              : CompletableFuture.completedFuture(false);
    return (player, destination) -> move(player, mount, destination, protection);
  }

  private static CompletableFuture<Boolean> move(
      Player player, Entity mount, Location destination, Protection protection) {
    if (!player.isOnline()
        || !mount.isValid()
        || !supported(mount)
        || !mount.equals(player.getVehicle())
        || mount.getPassengers().size() != 1
        || !mount.getPassengers().contains(player)
        || !safe(player, mount, destination, protection))
      return CompletableFuture.completedFuture(false);
    return mount.teleportAsync(destination);
  }

  private static boolean safe(
      Player player, Entity mount, Location destination, Protection protection) {
    var world = destination.getWorld();
    var halfWidth = Math.max(mount.getWidth(), player.getWidth()) / 2;
    var height = mount.getHeight() + player.getHeight();
    var minX = (int) Math.floor(destination.getX() - halfWidth);
    var maxX = (int) Math.floor(destination.getX() + halfWidth);
    var minZ = (int) Math.floor(destination.getZ() - halfWidth);
    var maxZ = (int) Math.floor(destination.getZ() + halfWidth);
    var minY = (int) Math.floor(destination.getY());
    var maxY = (int) Math.ceil(destination.getY() + height) - 1;
    if (minY < world.getMinHeight() || maxY >= world.getMaxHeight()) return false;
    var check = new LandingCheck(player, protection, world, minY, maxY);
    for (var x = minX; x <= maxX; x++) {
      for (var z = minZ; z <= maxZ; z++) {
        if (!safeColumn(check, x, z)) return false;
      }
    }
    return true;
  }

  private static boolean safeColumn(LandingCheck check, int x, int z) {
    if (!check.world().isChunkLoaded(x >> 4, z >> 4)) return false;
    for (var y = check.minY(); y <= check.maxY(); y++) {
      if (!safeCell(check.player(), check.protection(), check.world().getBlockAt(x, y, z)))
        return false;
    }
    return true;
  }

  private static boolean safeCell(
      Player player, Protection protection, org.bukkit.block.Block block) {
    return block.isPassable()
        && !block.isLiquid()
        && !HAZARDS.contains(block.getType())
        && protection
            .check(player.getUniqueId(), ProtectedAction.TELEPORT_INTO, block.getLocation())
            .isAllowed();
  }
}
