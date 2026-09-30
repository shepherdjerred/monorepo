package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.model.Condition;

/** Converts Minecraft world time to a clock. */
public final class GameTime {

  private static final long TICKS_PER_DAY = 24_000;
  private static final long TICKS_PER_HOUR = 1_000;
  private static final int SUNRISE_HOUR = 6;

  private GameTime() {}

  /** Minutes after midnight for a world's time in ticks, where tick 0 is 06:00. */
  public static int minuteOfDay(long ticks) {
    var inDay = Math.floorMod(ticks, TICKS_PER_DAY);
    var minutes = SUNRISE_HOUR * 60 + inDay * 60 / TICKS_PER_HOUR;
    return (int) (minutes % Condition.MINUTES_PER_DAY);
  }
}
