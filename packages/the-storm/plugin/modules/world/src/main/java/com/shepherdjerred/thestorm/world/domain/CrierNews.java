package com.shepherdjerred.thestorm.world.domain;

import java.util.List;

/** A read-only bulletin from the present world state and the historical Storm archives. */
public final class CrierNews {

  private static final long TICKS_PER_DAY = 24_000L;
  private static final List<String> ARCHIVES =
      List.of(
          "From the archives: old spawn had a blacksmith, bakery, tavern, and windmill.",
          "From the archives: the Bridge Hobo offered a repeatable fishing quest.",
          "From the archives: 21 eggs were hidden for the April 2015 Easter hunt.",
          "From the archives: Braxton tended the bank when it opened in 2015.");

  private CrierNews() {}

  /** One bulletin per request. Full game time chooses a stable archive item for that day. */
  public static List<String> bulletin(
      long fullTime, long time, boolean storming, boolean thundering) {
    if (fullTime < 0 || time < 0 || time >= TICKS_PER_DAY) {
      throw new IllegalArgumentException("invalid world clock");
    }
    var day = Math.floorDiv(fullTime, TICKS_PER_DAY);
    var phase =
        time < 6_000
            ? "morning"
            : time < 12_000 ? "afternoon" : time < 18_000 ? "evening" : "night";
    var weather = thundering ? "thunder rolls" : storming ? "rain falls" : "the skies are clear";
    return List.of(
        "Hear ye! In the main world this " + phase + ", " + weather + ".",
        ARCHIVES.get(Math.floorMod(day, ARCHIVES.size())));
  }
}
