package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.time.Duration;
import java.util.List;
import java.util.Locale;

/** Small formatting helpers shared by the tracks' messages. */
public final class Wording {

  private static final List<String> NUMERALS = List.of("I", "II", "III", "IV", "V");

  private Wording() {}

  /** {@code level} as a Roman numeral (I to V). */
  public static String numeral(int level) {
    if (level < 1 || level > Track.MAX_LEVEL) {
      throw new IllegalArgumentException("level must be 1.." + Track.MAX_LEVEL + ": " + level);
    }
    return NUMERALS.get(level - 1);
  }

  /** {@code amount} crystals with thousands separators, for example "1,500 crystals". */
  public static String crystals(long amount) {
    return String.format(Locale.ROOT, "%,d %s", amount, amount == 1 ? "crystal" : "crystals");
  }

  /**
   * A wait as a player reads it, rounded up so it is never shorter than the real wait: "45s",
   * "12m", "3h 5m".
   */
  public static String wait(Duration duration) {
    if (duration.isNegative() || duration.isZero()) {
      return "0s";
    }
    var seconds = duration.toSeconds() + (duration.toNanosPart() > 0 ? 1 : 0);
    if (seconds < 60) {
      return seconds + "s";
    }
    var minutes = (seconds + 59) / 60;
    if (minutes < 60) {
      return minutes + "m";
    }
    return minutes / 60 + "h " + minutes % 60 + "m";
  }
}
