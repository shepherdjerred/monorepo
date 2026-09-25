package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.place.SafeSpots;
import com.shepherdjerred.thestorm.essentials.domain.place.SafeSpots.BlockPos;
import com.shepherdjerred.thestorm.essentials.domain.place.SafeSpots.Ground;
import com.shepherdjerred.thestorm.essentials.domain.place.SafeSpots.HeightRange;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;

/**
 * {@link SafeSpots} over a loaded Paper world. Reads blocks, so the chunk must be loaded and the
 * caller must be on the main thread.
 */
final class SafeLocations {

  private static final Set<Material> HAZARDS =
      EnumSet.of(
          Material.LAVA,
          Material.FIRE,
          Material.SOUL_FIRE,
          Material.CAMPFIRE,
          Material.SOUL_CAMPFIRE,
          Material.MAGMA_BLOCK,
          Material.CACTUS,
          Material.SWEET_BERRY_BUSH,
          Material.POWDER_SNOW,
          Material.WITHER_ROSE,
          Material.POINTED_DRIPSTONE,
          Material.COBWEB,
          Material.NETHER_PORTAL,
          Material.END_PORTAL,
          Material.END_GATEWAY);

  private SafeLocations() {}

  /** What {@code material} means for a player standing in or on it. */
  static Ground ground(Material material) {
    if (HAZARDS.contains(material)) {
      return Ground.HAZARD;
    }
    return material.isSolid() ? Ground.FLOOR : Ground.OPEN;
  }

  /** Whether a player can stand with their feet in {@code feet}'s block. */
  static boolean isSafe(Location feet) {
    var world = feet.getWorld();
    return SafeSpots.isSafe(view(world), range(world), BlockPos.of(Positions.of(feet)));
  }

  /**
   * {@code target} moved up or down its column to the nearest safe block, keeping its horizontal
   * position and facing; empty if there is none within {@link SafeSpots#SEARCH_DISTANCE}.
   */
  static Optional<Location> nearestSafe(Location target) {
    var world = target.getWorld();
    return SafeSpots.find(view(world), range(world), BlockPos.of(Positions.of(target)))
        .map(
            spot -> {
              var safe = target.clone();
              safe.setY(spot.y());
              return safe;
            });
  }

  /** Whether the chunk holding {@code location} is loaded, so its blocks can be read at once. */
  static boolean isLoaded(Location location) {
    return location.getWorld().isChunkLoaded(location.getBlockX() >> 4, location.getBlockZ() >> 4);
  }

  private static SafeSpots.BlockView view(World world) {
    return (x, y, z) -> ground(world.getBlockAt(x, y, z).getType());
  }

  private static HeightRange range(World world) {
    return new HeightRange(world.getMinHeight(), world.getMaxHeight());
  }
}
