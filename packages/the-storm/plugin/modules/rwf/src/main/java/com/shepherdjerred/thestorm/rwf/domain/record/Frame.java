package com.shepherdjerred.thestorm.rwf.domain.record;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/**
 * One combatant's state in one tick, quantised so a long match stays small.
 *
 * @param tick ticks since the match went live
 * @param pseudonym who
 * @param x position × {@link #POSITION_SCALE}
 * @param y position × {@link #POSITION_SCALE}
 * @param z position × {@link #POSITION_SCALE}
 * @param yaw 0 to 255 for a full turn
 * @param pitch -64 to 64 for -90 to 90 degrees
 * @param health health × {@link #HEALTH_SCALE}
 * @param slot the held hotbar slot, 0 to 8
 * @param flags {@link #SNEAKING}, {@link #SPRINTING}, {@link #ON_FIRE}, {@link #BLOCKING} bits
 */
public record Frame(
    long tick,
    String pseudonym,
    int x,
    int y,
    int z,
    int yaw,
    int pitch,
    int health,
    int slot,
    int flags) {

  /** Positions are kept to 1/32 of a block. */
  public static final int POSITION_SCALE = 32;

  /** Health is kept to quarter points. */
  public static final int HEALTH_SCALE = 4;

  public static final int SNEAKING = 1;
  public static final int SPRINTING = 2;
  public static final int ON_FIRE = 4;
  public static final int BLOCKING = 8;

  public Frame {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (!RosterEntry.PSEUDONYM.matcher(pseudonym).matches()) {
      throw new IllegalArgumentException("pseudonym must be short lower-case alphanumeric");
    }
    if (yaw < 0 || yaw > 255 || pitch < -64 || pitch > 64) {
      throw new IllegalArgumentException("yaw must be 0-255 and pitch -64..64");
    }
    if (health < 0 || slot < 0 || slot > 8 || flags < 0 || flags > 15) {
      throw new IllegalArgumentException("health >= 0, slot 0-8, flags 0-15");
    }
  }

  public static int quantizePosition(double coordinate) {
    return (int) Math.round(coordinate * POSITION_SCALE);
  }

  /** Degrees to a byte, wrapping. */
  public static int quantizeYaw(float degrees) {
    var turn = ((degrees % 360) + 360) % 360;
    return (int) Math.floor(turn / 360 * 256) & 255;
  }

  /** -90..90 degrees to -64..64. */
  public static int quantizePitch(float degrees) {
    return Math.round(Math.max(-90, Math.min(90, degrees)) / 90 * 64);
  }

  public static int quantizeHealth(double health) {
    return (int) Math.round(Math.max(0, health) * HEALTH_SCALE);
  }

  /** The position this frame stands for. */
  public Vec3 position() {
    return new Vec3(
        x / (double) POSITION_SCALE, y / (double) POSITION_SCALE, z / (double) POSITION_SCALE);
  }
}
