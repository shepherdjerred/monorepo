package com.shepherdjerred.thestorm.mobs.domain.level;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Everything that decides a mob's level.
 *
 * @param cap the highest level; the 2023 revival capped at 50
 * @param distanceBands the rings around the world spawn, the first starting at 0 and each further
 *     out than the last
 * @param worlds the worlds that level mobs, by world name
 * @param depth extra levels underground
 * @param moonBonusByPhase levels added at night, indexed by moon phase (0 is the full moon, 4 the
 *     new moon)
 */
public record LevelRules(
    int cap,
    List<DistanceBand> distanceBands,
    Map<String, WorldRule> worlds,
    DepthRule depth,
    List<Integer> moonBonusByPhase) {

  /** Minecraft's moon has eight phases. */
  public static final int MOON_PHASES = 8;

  /** The highest level cap allowed. */
  public static final int MAX_CAP = 1000;

  public LevelRules {
    if (cap < 2 || cap > MAX_CAP) {
      throw new IllegalArgumentException("cap must be 2-" + MAX_CAP + ": " + cap);
    }
    distanceBands = List.copyOf(distanceBands);
    worlds = Map.copyOf(worlds);
    moonBonusByPhase = List.copyOf(moonBonusByPhase);
    requireBands(distanceBands, cap);
    if (moonBonusByPhase.size() != MOON_PHASES) {
      throw new IllegalArgumentException(
          "moonBonusByPhase needs " + MOON_PHASES + " entries, got " + moonBonusByPhase.size());
    }
    if (moonBonusByPhase.stream().anyMatch(bonus -> bonus < 0 || bonus > cap)) {
      throw new IllegalArgumentException("moon bonuses must be 0-" + cap);
    }
  }

  private static void requireBands(List<DistanceBand> bands, int cap) {
    if (bands.isEmpty() || bands.getFirst().from() != 0) {
      throw new IllegalArgumentException("distanceBands must start with a band from 0");
    }
    for (var i = 0; i < bands.size(); i++) {
      var band = bands.get(i);
      if (band.max() > cap) {
        throw new IllegalArgumentException(
            "distance band from " + band.from() + " goes above the cap " + cap);
      }
      if (i > 0 && band.from() <= bands.get(i - 1).from()) {
        throw new IllegalArgumentException(
            "distanceBands must be ordered by from, each further out: " + band.from());
      }
    }
  }

  /** The band for a (scaled) distance from the world spawn. */
  public DistanceBand bandAt(double distance) {
    var chosen = distanceBands.getFirst();
    for (var band : distanceBands) {
      if (band.from() <= distance) {
        chosen = band;
      }
    }
    return chosen;
  }

  /** The rule for {@code world}, or empty when mobs there are never levelled. */
  public Optional<WorldRule> world(String world) {
    return Optional.ofNullable(worlds.get(world));
  }

  /** The levels the moon adds at night in {@code phase} (0-7). */
  public int moonBonus(int phase) {
    return moonBonusByPhase.get(phase);
  }
}
