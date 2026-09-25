package com.shepherdjerred.thestorm.spells.domain.geometry;

/**
 * Dawn and Dusk shift one player's sky, never the world's. The shift is a relative offset, so the
 * player's sun keeps moving at the normal pace from the new time.
 */
public final class PersonalTime {

  /** Ticks in a Minecraft day. */
  public static final long DAY = 24_000;

  private PersonalTime() {}

  /**
   * The offset (0 to one day) that makes a player whose world is at {@code worldTime} see {@code
   * targetTime}.
   */
  public static long offset(long worldTime, long targetTime) {
    if (targetTime < 0 || targetTime >= DAY) {
      throw new IllegalArgumentException("target time must be 0.." + (DAY - 1) + ": " + targetTime);
    }
    return Math.floorMod(targetTime - worldTime, DAY);
  }
}
