package com.shepherdjerred.thestorm.mobs.domain.level;

/**
 * Where and when a mob spawns.
 *
 * @param world the world name
 * @param distance the horizontal distance from the world spawn, in blocks
 * @param y the block height
 * @param moonPhase the moon phase, 0 (full) to 7
 * @param timeOfDay the world's time of day, 0 to 23999 ticks
 */
public record SpawnSite(String world, double distance, int y, int moonPhase, long timeOfDay) {

  /** Ticks in a Minecraft day. */
  public static final long DAY = 24_000;

  /** When night starts: the moon is up and the sky dark. */
  public static final long NIGHT_START = 13_000;

  /** When night ends, at sunrise. */
  public static final long NIGHT_END = 23_000;

  public SpawnSite {
    if (!(distance >= 0) || Double.isInfinite(distance)) {
      throw new IllegalArgumentException("distance must not be negative: " + distance);
    }
    if (moonPhase < 0 || moonPhase >= LevelRules.MOON_PHASES) {
      throw new IllegalArgumentException("moonPhase must be 0-7: " + moonPhase);
    }
    if (timeOfDay < 0 || timeOfDay >= DAY) {
      throw new IllegalArgumentException("timeOfDay must be 0-23999: " + timeOfDay);
    }
  }

  /** Whether it is night, when the moon adds levels. */
  public boolean night() {
    return timeOfDay >= NIGHT_START && timeOfDay < NIGHT_END;
  }
}
