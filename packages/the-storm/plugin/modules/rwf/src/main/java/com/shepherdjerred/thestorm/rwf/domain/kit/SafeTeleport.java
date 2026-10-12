// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/utils/UtilLoc.java, isSafeTeleport);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.util.function.Function;

/**
 * Whether a player could be teleported to a spot and land safely, as Red Warfare's {@code
 * isSafeTeleport} decided for the Time Machine: no pressure plate or tripwire in the 3×3×3 around
 * the feet, two blocks of headroom, and something to stand on within two blocks below, with no
 * half-solid block in the way. The adapter says what each block is.
 */
public final class SafeTeleport {

  /** What a block is to someone landing on or in it. */
  public enum Footing {
    /** A pressure plate or tripwire (or something burning): never land next to one. */
    TRAP,
    /** Nothing to collide with: air, plants, water. */
    CLEAR,
    /** A solid block to stand on. */
    STANDABLE,
    /** Collides but cannot be stood on safely. */
    PARTIAL,
  }

  private SafeTeleport() {}

  /**
   * Whether a player whose feet are in {@code feet} lands safely; {@code minY} is the lowest block
   * of the world and {@code world} says what each block is.
   */
  public static boolean safe(BlockPos feet, int minY, Function<BlockPos, Footing> world) {
    return feet.y() >= minY
        && !nearTrap(feet, world)
        && headroom(feet, world)
        && standing(feet, minY, world);
  }

  /** A pressure plate or tripwire in the 3×3×3 around the feet. */
  private static boolean nearTrap(BlockPos feet, Function<BlockPos, Footing> world) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        for (var dz = -1; dz <= 1; dz++) {
          if (world.apply(feet.plus(dx, dy, dz)) == Footing.TRAP) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** Nothing to collide with where the feet and head go. */
  private static boolean headroom(BlockPos feet, Function<BlockPos, Footing> world) {
    return world.apply(feet) == Footing.CLEAR && world.apply(feet.plus(0, 1, 0)) == Footing.CLEAR;
  }

  /** Something to stand on within two blocks below, with nothing half-solid above it. */
  private static boolean standing(BlockPos feet, int minY, Function<BlockPos, Footing> world) {
    for (var dy = -1; dy >= -2; dy--) {
      var below = feet.plus(0, dy, 0);
      if (below.y() < minY) {
        return false;
      }
      var footing = world.apply(below);
      if (footing != Footing.CLEAR) {
        return footing == Footing.STANDABLE;
      }
    }
    return false;
  }
}
