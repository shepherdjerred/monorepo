package com.shepherdjerred.thestorm.npcs.domain.schedule;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.regex.Pattern;

/**
 * A minute of the in-game day, 0 (00:00) to 1439 (23:59).
 *
 * <p>Minecraft's day starts at 06:00: world time 0 is 06:00, 6000 is noon, 18000 is midnight. One
 * in-game hour is 1000 ticks.
 */
public record TimeOfDay(int minute) implements Comparable<TimeOfDay> {

  /** Minutes in a day. */
  public static final int DAY = 24 * 60;

  private static final long TICKS_PER_DAY = 24_000;
  private static final Pattern CLOCK = Pattern.compile("([01]\\d|2[0-3]):([0-5]\\d)");

  public TimeOfDay {
    if (minute < 0 || minute >= DAY) {
      throw new IllegalArgumentException("minute of day must be 0.." + (DAY - 1) + ": " + minute);
    }
  }

  public static TimeOfDay of(int hour, int minute) {
    return new TimeOfDay(hour * 60 + minute);
  }

  /** Parses {@code HH:MM} on a 24-hour clock. */
  public static Result<TimeOfDay, String> parse(String text) {
    var match = CLOCK.matcher(text);
    if (!match.matches()) {
      return Result.err("time must be HH:MM on a 24-hour clock, such as 06:00 or 22:30: " + text);
    }
    return Result.ok(of(Integer.parseInt(match.group(1)), Integer.parseInt(match.group(2))));
  }

  /** The time of day for a world's day time ({@code World#getTime()}, any non-negative tick). */
  public static TimeOfDay fromWorldTicks(long ticks) {
    if (ticks < 0) {
      throw new IllegalArgumentException("world time must not be negative: " + ticks);
    }
    var ofDay = ticks % TICKS_PER_DAY;
    // 1000 ticks per hour, so 50/3 ticks per minute; 0 ticks is 06:00.
    var minutesSinceSix = (int) (ofDay * 60 / 1000);
    return new TimeOfDay((minutesSinceSix + 6 * 60) % DAY);
  }

  @Override
  public int compareTo(TimeOfDay other) {
    return Integer.compare(minute, other.minute);
  }

  @Override
  public String toString() {
    return "%02d:%02d".formatted(minute / 60, minute % 60);
  }
}
