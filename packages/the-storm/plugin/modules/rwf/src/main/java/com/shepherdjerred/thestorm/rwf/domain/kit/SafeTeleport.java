// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/utils/UtilLoc.java, isSafeTeleport);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.util.List;
import java.util.function.Function;

/**
 * Whether a player could be teleported to a spot and land safely, exactly as Red Warfare's {@code
 * UtilLoc.isSafeTeleport} decided for the Time Machine:
 *
 * <ol>
 *   <li>the feet must be at least one block above the bottom of the world;
 *   <li>no pressure plate or tripwire ({@link Footing#TRAP}) at any {@link #FACES} offset from the
 *       feet block, shifted one block down, not at all, and one block up (the original walked
 *       Bukkit's nineteen {@code BlockFace}s, whose up and down faces reach two blocks);
 *   <li>the feet and head blocks must be non-solid ({@link Footing#CLEAR} or a trap);
 *   <li>within two blocks below, above the bottom of the world, a block that is partially solid but
 *       cannot be stood on makes the spot unsafe and a standable one makes it safe, the nearer
 *       first; with neither, it is unsafe.
 * </ol>
 *
 * The adapter says what each block is.
 */
public final class SafeTeleport {

  /** What a block is to someone landing on or in it, in the original's block tables. */
  public enum Footing {
    /** A stone, wooden or iron pressure plate, or a tripwire: never land next to one. */
    TRAP,
    /** Non-solid: nothing to collide with, such as air, plants, torches or fire. */
    CLEAR,
    /** Fully solid, or partially solid and standable, such as a slab, stair or fence. */
    STANDABLE,
    /** Partially solid and not standable, such as water, lava, a cobweb, door or pane. */
    PARTIAL,
  }

  /**
   * The offsets of Bukkit's {@code BlockFace.values()}, in its order: north, east, south, west, up,
   * down, the four diagonals, the eight secondary directions and self.
   */
  public static final List<BlockPos> FACES =
      List.of(
          new BlockPos(0, 0, -1),
          new BlockPos(1, 0, 0),
          new BlockPos(0, 0, 1),
          new BlockPos(-1, 0, 0),
          new BlockPos(0, 1, 0),
          new BlockPos(0, -1, 0),
          new BlockPos(1, 0, -1),
          new BlockPos(-1, 0, -1),
          new BlockPos(1, 0, 1),
          new BlockPos(-1, 0, 1),
          new BlockPos(-2, 0, -1),
          new BlockPos(-1, 0, -2),
          new BlockPos(1, 0, -2),
          new BlockPos(2, 0, -1),
          new BlockPos(2, 0, 1),
          new BlockPos(1, 0, 2),
          new BlockPos(-1, 0, 2),
          new BlockPos(-2, 0, 1),
          new BlockPos(0, 0, 0));

  private SafeTeleport() {}

  /**
   * Whether a player whose feet are in {@code feet} lands safely; {@code minY} is the lowest block
   * of the world (the original's 0) and {@code world} says what each block is.
   */
  public static boolean safe(BlockPos feet, int minY, Function<BlockPos, Footing> world) {
    return feet.y() >= minY + 1
        && !nearTrap(feet, world)
        && headroom(feet, world)
        && standing(feet, minY, world);
  }

  private static boolean nearTrap(BlockPos feet, Function<BlockPos, Footing> world) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var face : FACES) {
        if (world.apply(feet.plus(face.x(), face.y() + dy, face.z())) == Footing.TRAP) {
          return true;
        }
      }
    }
    return false;
  }

  private static boolean headroom(BlockPos feet, Function<BlockPos, Footing> world) {
    return nonSolid(world.apply(feet)) && nonSolid(world.apply(feet.plus(0, 1, 0)));
  }

  private static boolean nonSolid(Footing footing) {
    return footing == Footing.CLEAR || footing == Footing.TRAP;
  }

  private static boolean standing(BlockPos feet, int minY, Function<BlockPos, Footing> world) {
    for (var dy = -1; dy >= -2; dy--) {
      var below = feet.plus(0, dy, 0);
      if (below.y() < minY) {
        return false;
      }
      var footing = world.apply(below);
      if (footing == Footing.PARTIAL) {
        return false;
      }
      if (footing == Footing.STANDABLE) {
        return true;
      }
    }
    return false;
  }
}
