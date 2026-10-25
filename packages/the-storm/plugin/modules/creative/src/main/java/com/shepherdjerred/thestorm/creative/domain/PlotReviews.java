package com.shepherdjerred.thestorm.creative.domain;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** One score per player, from 1 through 5, and a short public comment. */
public final class PlotReviews {

  private PlotReviews() {}

  /**
   * Records {@code score} for {@code player}, replacing any earlier score. The map stays one entry
   * per player.
   */
  public static Map<UUID, Integer> rate(Map<UUID, Integer> current, UUID player, int score) {
    if (score < 1 || score > 5) {
      throw new IllegalArgumentException("rating is 1 through 5");
    }
    var next = new LinkedHashMap<>(current);
    next.put(player, score);
    return Map.copyOf(next);
  }

  /** A comment that is not blank, has no line break, and fits {@code limit}. */
  public static boolean fits(String text, int limit) {
    var trimmed = text.strip();
    return !trimmed.isEmpty() && trimmed.indexOf('\n') < 0 && trimmed.length() <= limit;
  }

  /** One decimal, truncated, for the scores already stored. Empty when nobody has rated. */
  public static String average(Map<UUID, Integer> scores) {
    if (scores.isEmpty()) {
      return "";
    }
    int sum = 0;
    for (var score : scores.values()) {
      sum += score;
    }
    int tenths = sum * 10 / scores.size();
    return (tenths / 10) + "." + Math.floorMod(tenths, 10);
  }
}
