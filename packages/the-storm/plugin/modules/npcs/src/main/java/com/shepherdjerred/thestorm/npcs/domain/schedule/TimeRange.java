package com.shepherdjerred.thestorm.npcs.domain.schedule;

/**
 * A half-open span of the day, {@code [from, to)}. A range whose end is before its start wraps past
 * midnight ({@code 22:00-06:00}); a range whose ends are equal is the whole day.
 */
public record TimeRange(TimeOfDay from, TimeOfDay to) {

  public boolean contains(TimeOfDay time) {
    if (from.equals(to)) {
      return true;
    }
    if (from.compareTo(to) < 0) {
      return time.compareTo(from) >= 0 && time.compareTo(to) < 0;
    }
    return time.compareTo(from) >= 0 || time.compareTo(to) < 0;
  }

  /** How many minutes the range covers, 1..1440. */
  public int minutes() {
    var length = Math.floorMod(to.minute() - from.minute(), TimeOfDay.DAY);
    return length == 0 ? TimeOfDay.DAY : length;
  }

  @Override
  public String toString() {
    return from + "-" + to;
  }
}
