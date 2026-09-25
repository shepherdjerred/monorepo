package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Test fixtures: the default prices and a compact way to write progress. */
public final class Progressions {

  public static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");

  public static final Pricing DEFAULT_PRICING =
      new Pricing(
          List.of(1_000L, 2_500L, 5_000L, 10_000L, 20_000L),
          List.of(
              BigDecimal.ONE,
              new BigDecimal("1.5"),
              BigDecimal.TWO,
              BigDecimal.valueOf(3),
              BigDecimal.valueOf(4)));

  private Progressions() {}

  /** Crystal amounts the way the economy writes them in sentences. */
  public static String crystals(long amount) {
    return String.format(
        java.util.Locale.ROOT, "%,d %s", amount, amount == 1 ? "crystal" : "crystals");
  }

  /**
   * Progress owning tracks in the order given, alternating track and level, for example {@code
   * owning(MECHANIC, 3, ENGINEER, 1)}. No purchase cooldown.
   */
  public static TrackProgress owning(Object... trackThenLevel) {
    var owned = new ArrayList<TrackLevel>();
    for (var index = 0; index < trackThenLevel.length; index += 2) {
      owned.add(new TrackLevel((Track) trackThenLevel[index], (Integer) trackThenLevel[index + 1]));
    }
    return new TrackProgress(owned, Optional.empty());
  }

  /** {@code progress} last bought at {@code at}. */
  public static TrackProgress boughtAt(TrackProgress progress, Instant at) {
    return new TrackProgress(progress.owned(), Optional.of(at));
  }
}
