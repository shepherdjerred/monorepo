package com.shepherdjerred.thestorm.rwf.domain.lobby;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;

/**
 * When drafted bots walk into the lobby: one after another, each a seeded one to eight seconds
 * after the last, so they trickle in like players rather than appearing at once. The whole train is
 * squeezed to fit {@code budget} (a share of the countdown), so every bot is in before the start.
 */
public final class Arrivals {

  /** The shortest gap between two arrivals, before squeezing. */
  public static final Duration MIN_GAP = Duration.ofSeconds(1);

  /** The longest gap between two arrivals, before squeezing. */
  public static final Duration MAX_GAP = Duration.ofSeconds(8);

  private Arrivals() {}

  /**
   * How long after the draft each of {@code count} bots arrives, in arrival order: ascending,
   * deterministic in {@code seed}, the last no later than {@code budget}.
   */
  public static List<Duration> offsets(int count, long seed, Duration budget) {
    if (count < 0 || budget.isNegative()) {
      throw new IllegalArgumentException("count and budget must not be negative");
    }
    var random = new SplittableRandom(seed);
    var offsets = new ArrayList<Long>();
    var at = 0L;
    for (var i = 0; i < count; i++) {
      at += random.nextLong(MIN_GAP.toMillis(), MAX_GAP.toMillis() + 1);
      offsets.add(at);
    }
    var limit = budget.toMillis();
    var scale = at > limit ? limit / (double) at : 1;
    return offsets.stream().map(millis -> Duration.ofMillis(Math.round(millis * scale))).toList();
  }
}
