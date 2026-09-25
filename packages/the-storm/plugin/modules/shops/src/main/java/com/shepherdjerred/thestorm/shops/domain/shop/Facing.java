package com.shepherdjerred.thestorm.shops.domain.shop;

/** The four horizontal directions, in clockwise order seen from above. */
public enum Facing {
  NORTH(0, -1),
  EAST(1, 0),
  SOUTH(0, 1),
  WEST(-1, 0);

  private final int dx;
  private final int dz;

  Facing(int dx, int dz) {
    this.dx = dx;
    this.dz = dz;
  }

  public int dx() {
    return dx;
  }

  public int dz() {
    return dz;
  }

  public Facing clockwise() {
    return switch (this) {
      case NORTH -> EAST;
      case EAST -> SOUTH;
      case SOUTH -> WEST;
      case WEST -> NORTH;
    };
  }

  public Facing counterClockwise() {
    return switch (this) {
      case NORTH -> WEST;
      case WEST -> SOUTH;
      case SOUTH -> EAST;
      case EAST -> NORTH;
    };
  }
}
