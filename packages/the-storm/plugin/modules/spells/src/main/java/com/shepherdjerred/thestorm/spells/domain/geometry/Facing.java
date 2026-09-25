package com.shepherdjerred.thestorm.spells.domain.geometry;

/** The four horizontal directions a player can face. */
public enum Facing {
  SOUTH(0, 1),
  WEST(-1, 0),
  NORTH(0, -1),
  EAST(1, 0);

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

  /** The direction 90 degrees to this one's left, as seen by someone facing it. */
  public Facing left() {
    return switch (this) {
      case SOUTH -> EAST;
      case WEST -> SOUTH;
      case NORTH -> WEST;
      case EAST -> NORTH;
    };
  }

  /** The facing nearest {@code yaw} (Minecraft degrees: 0 south, 90 west, 180 north, 270 east). */
  public static Facing fromYaw(float yaw) {
    var normalized = ((yaw % 360) + 360) % 360;
    var quarter = (int) Math.floor((normalized + 45) / 90) % 4;
    return values()[quarter];
  }
}
