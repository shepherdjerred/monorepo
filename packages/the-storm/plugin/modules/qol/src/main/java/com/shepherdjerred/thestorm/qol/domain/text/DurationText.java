package com.shepherdjerred.thestorm.qol.domain.text;

import java.time.Duration;

/**
 * Short durations for players, from whole seconds rounded up: "14s", "12m 5s", "3h 20m", "2d 4h".
 */
public final class DurationText {

  private DurationText() {}

  public static String of(Duration duration) {
    if (duration.isNegative()) {
      throw new IllegalArgumentException("duration must not be negative: " + duration);
    }
    var seconds = duration.getSeconds() + (duration.getNano() > 0 ? 1 : 0);
    var days = seconds / 86_400;
    var hours = seconds % 86_400 / 3_600;
    var minutes = seconds % 3_600 / 60;
    var secs = seconds % 60;
    if (days > 0) {
      return days + "d" + (hours > 0 ? " " + hours + "h" : "");
    }
    if (hours > 0) {
      return hours + "h" + (minutes > 0 ? " " + minutes + "m" : "");
    }
    if (minutes > 0) {
      return minutes + "m" + (secs > 0 ? " " + secs + "s" : "");
    }
    return secs + "s";
  }
}
