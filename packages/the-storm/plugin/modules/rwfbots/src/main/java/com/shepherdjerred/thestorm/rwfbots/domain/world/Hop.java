package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** How a waypoint is reached from the one before it. */
public enum Hop {
  WALK(0),
  JUMP(1),
  DROP(2),
  CLIMB(3),
  LEAP(4),
  SWIM(5);

  private final byte code;

  Hop(int code) {
    this.code = (byte) code;
  }

  /** The stable byte stored in baked artifacts. */
  public byte code() {
    return code;
  }

  /** The hop stored as {@code code}; anything else is corrupt data. */
  public static Hop ofCode(byte code) {
    return switch (code) {
      case 0 -> WALK;
      case 1 -> JUMP;
      case 2 -> DROP;
      case 3 -> CLIMB;
      case 4 -> LEAP;
      case 5 -> SWIM;
      default -> throw new IllegalArgumentException("unknown hop code: " + code);
    };
  }
}
