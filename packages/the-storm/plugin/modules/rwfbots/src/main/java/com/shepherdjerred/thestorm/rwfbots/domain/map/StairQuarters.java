package com.shepherdjerred.thestorm.rwfbots.domain.map;

/**
 * The quarters of a block's top, as mask bits, and the quarters a stair leaves half a block high.
 * North is towards negative z and west towards negative x, as in Minecraft.
 */
public final class StairQuarters {
  public static final int NORTH_WEST = 1;
  public static final int NORTH_EAST = 2;
  public static final int SOUTH_WEST = 4;
  public static final int SOUTH_EAST = 8;
  public static final int ALL = NORTH_WEST | NORTH_EAST | SOUTH_WEST | SOUTH_EAST;

  /** A stair's horizontal facing: the side its full-height back stands on. */
  public enum Facing {
    NORTH,
    EAST,
    SOUTH,
    WEST
  }

  /** A stair's shape as Minecraft connects it to its neighbours. */
  public enum Shape {
    STRAIGHT,
    INNER_LEFT,
    INNER_RIGHT,
    OUTER_LEFT,
    OUTER_RIGHT
  }

  private StairQuarters() {}

  /**
   * The quarters of a bottom-half stair that are only its half-high step. A straight stair's back
   * half is full height; an outer corner raises only the back quarter on its left or right (looking
   * the way it faces), and an inner corner raises its back half and the front quarter on that side.
   */
  public static int halfStep(Facing facing, Shape shape) {
    var back = side(facing);
    var left = side(counterClockwise(facing));
    var right = side(clockwise(facing));
    var full =
        switch (shape) {
          case STRAIGHT -> back;
          case OUTER_LEFT -> back & left;
          case OUTER_RIGHT -> back & right;
          case INNER_LEFT -> back | left;
          case INNER_RIGHT -> back | right;
        };
    return ALL & ~full;
  }

  /**
   * The quarters a body walking one block in {@code (dx, dz)} first sets foot on: the side of the
   * cell it enters from. Zero for a diagonal step, which crosses a corner.
   */
  public static int entered(int dx, int dz) {
    if (dx != 0 && dz != 0) return 0;
    if (dx > 0) return side(Facing.WEST);
    if (dx < 0) return side(Facing.EAST);
    if (dz > 0) return side(Facing.NORTH);
    if (dz < 0) return side(Facing.SOUTH);
    return 0;
  }

  /**
   * The quarters a body walking one block in {@code (dx, dz)} last stands on as it leaves its cell:
   * the side it walks out of. Every quarter for a diagonal step, which may cross any of them.
   */
  public static int left(int dx, int dz) {
    if (dx != 0 && dz != 0) return ALL;
    return entered(-dx, -dz);
  }

  private static int side(Facing facing) {
    return switch (facing) {
      case NORTH -> NORTH_WEST | NORTH_EAST;
      case EAST -> NORTH_EAST | SOUTH_EAST;
      case SOUTH -> SOUTH_WEST | SOUTH_EAST;
      case WEST -> NORTH_WEST | SOUTH_WEST;
    };
  }

  private static Facing clockwise(Facing facing) {
    return switch (facing) {
      case NORTH -> Facing.EAST;
      case EAST -> Facing.SOUTH;
      case SOUTH -> Facing.WEST;
      case WEST -> Facing.NORTH;
    };
  }

  private static Facing counterClockwise(Facing facing) {
    return clockwise(clockwise(clockwise(facing)));
  }
}
