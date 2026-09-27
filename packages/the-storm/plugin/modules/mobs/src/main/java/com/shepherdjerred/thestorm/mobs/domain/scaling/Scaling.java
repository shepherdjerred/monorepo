package com.shepherdjerred.thestorm.mobs.domain.scaling;

import java.util.EnumSet;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * How much each stat grows by the level cap, overall and for particular mob types. A level-1 mob is
 * vanilla; the bonus grows evenly with level to the full value at the cap.
 *
 * @param atCap every stat's bonus at the cap
 * @param byType bonuses that replace {@code atCap} for one mob type (such as endermen, whose health
 *     and speed the 2023 revival left alone), keyed by the entity type's key without namespace
 */
public record Scaling(Map<Stat, Double> atCap, Map<String, Map<Stat, Double>> byType) {

  public Scaling {
    atCap = Map.copyOf(atCap);
    byType = copy(byType);
    var missing = EnumSet.allOf(Stat.class);
    missing.removeAll(atCap.keySet());
    if (!missing.isEmpty()) {
      throw new IllegalArgumentException("atCap is missing " + missing);
    }
    atCap.forEach(Scaling::requireValid);
    byType.forEach(
        (type, stats) -> {
          if (type.isBlank() || !type.equals(type.toLowerCase(Locale.ROOT))) {
            throw new IllegalArgumentException("mob types are lowercase keys: '" + type + "'");
          }
          stats.forEach(Scaling::requireValid);
        });
  }

  private static Map<String, Map<Stat, Double>> copy(Map<String, Map<Stat, Double>> byType) {
    var copy = new HashMap<String, Map<Stat, Double>>();
    byType.forEach((type, stats) -> copy.put(type, Map.copyOf(stats)));
    return Map.copyOf(copy);
  }

  private static void requireValid(Stat stat, double value) {
    if (!(value >= 0) || Double.isInfinite(value)) {
      throw new IllegalArgumentException(stat + " must be a non-negative number: " + value);
    }
  }

  /** {@code stat}'s bonus at the cap for mobs of {@code type}. */
  public double atCap(Stat stat, String type) {
    var override = byType.get(type);
    if (override != null) {
      var value = override.get(stat);
      if (value != null) {
        return value;
      }
    }
    var value = atCap.get(stat);
    if (value == null) {
      throw new IllegalStateException("atCap was validated to hold every stat, but lacks " + stat);
    }
    return value;
  }

  /**
   * {@code stat}'s bonus for a mob of {@code type} at {@code level}: nothing at level 1, the full
   * {@link #atCap} value at {@code cap}, evenly in between.
   */
  public double bonus(Stat stat, String type, int level, int cap) {
    if (cap < 2 || level < 1 || level > cap) {
      throw new IllegalArgumentException("level " + level + " is outside 1-" + cap);
    }
    return atCap(stat, type) * (level - 1) / (cap - 1);
  }
}
