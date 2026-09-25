package com.shepherdjerred.thestorm.qol.adapter.paper;

import java.util.Optional;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;

/** A solid block with two open blocks above it. */
final class SafeColumn {

  private static final Set<Material> HAZARDS =
      Set.of(
          Material.MAGMA_BLOCK,
          Material.CACTUS,
          Material.CAMPFIRE,
          Material.SOUL_CAMPFIRE,
          Material.SWEET_BERRY_BUSH,
          Material.WITHER_ROSE,
          Material.POWDER_SNOW,
          Material.FIRE,
          Material.SOUL_FIRE,
          Material.LAVA,
          Material.POINTED_DRIPSTONE);

  private SafeColumn() {}

  /** Feet y of a surface landing at ({@code x}, {@code z}), if one exists. */
  static Optional<Integer> surface(World world, int x, int z) {
    return below(world, x, world.getHighestBlockYAt(x, z), z);
  }

  /** Feet y at or below {@code fromY}, for a death in a cave. */
  static Optional<Integer> below(World world, int x, int fromY, int z) {
    for (var y = fromY; y > world.getMinHeight(); y--) {
      if (standable(world, x, y, z)) {
        return Optional.of(y + 1);
      }
    }
    return Optional.empty();
  }

  private static boolean standable(World world, int x, int y, int z) {
    var ground = world.getBlockAt(x, y, z);
    if (!ground.isSolid() || ground.isLiquid() || HAZARDS.contains(ground.getType())) {
      return false;
    }
    return open(world.getBlockAt(x, y + 1, z)) && open(world.getBlockAt(x, y + 2, z));
  }

  private static boolean open(Block block) {
    return block.isPassable() && !block.isLiquid() && !HAZARDS.contains(block.getType());
  }
}
