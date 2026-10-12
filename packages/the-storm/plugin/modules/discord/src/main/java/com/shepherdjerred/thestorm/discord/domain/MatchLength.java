package com.shepherdjerred.thestorm.discord.domain;

import java.time.Duration;

/**
 * How long a minigame match took, as players read it: {@code 45s}, {@code 12m 5s}, {@code 1h 3m}.
 */
public final class MatchLength {

  private MatchLength() {}

  public static String format(Duration length) {
    if (length.isNegative()) {
      throw new IllegalArgumentException("a match cannot take negative time: " + length);
    }
    var hours = length.toHours();
    var minutes = length.toMinutesPart();
    var seconds = length.toSecondsPart();
    if (hours > 0) {
      return hours + "h " + minutes + "m";
    }
    if (minutes > 0) {
      return minutes + "m " + seconds + "s";
    }
    return seconds + "s";
  }
}
