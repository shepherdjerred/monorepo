package com.shepherdjerred.thestorm.mechanics.domain.grid;

import java.util.List;

/** The six block faces. */
public enum Direction {
  NORTH(0, 0, -1),
  EAST(1, 0, 0),
  SOUTH(0, 0, 1),
  WEST(-1, 0, 0),
  UP(0, 1, 0),
  DOWN(0, -1, 0);

  /** The four compass directions, clockwise from north. */
  public static final List<Direction> HORIZONTAL = List.of(NORTH, EAST, SOUTH, WEST);

  private final int dx;
  private final int dy;
  private final int dz;

  Direction(int dx, int dy, int dz) {
    this.dx = dx;
    this.dy = dy;
    this.dz = dz;
  }

  public int dx() {
    return dx;
  }

  public int dy() {
    return dy;
  }

  public int dz() {
    return dz;
  }

  public Direction opposite() {
    return switch (this) {
      case NORTH -> SOUTH;
      case SOUTH -> NORTH;
      case EAST -> WEST;
      case WEST -> EAST;
      case UP -> DOWN;
      case DOWN -> UP;
    };
  }

  public boolean isHorizontal() {
    return dy == 0;
  }

  /** The compass direction a quarter turn clockwise (seen from above). */
  public Direction clockwise() {
    return switch (this) {
      case NORTH -> EAST;
      case EAST -> SOUTH;
      case SOUTH -> WEST;
      case WEST -> NORTH;
      case UP, DOWN ->
          throw new IllegalArgumentException("only a compass direction turns: " + this);
    };
  }
}
