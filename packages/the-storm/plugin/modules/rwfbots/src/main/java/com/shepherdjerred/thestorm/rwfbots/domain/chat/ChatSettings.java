package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Voice;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import java.util.Objects;

/**
 * How much bots talk.
 *
 * @param chances the base chance, 0..1, that an eligible bot speaks at each moment
 * @param verbosity the factor each verbosity applies to every chance, above 0 and at most 4
 * @param rivalBoost the factor, 1..4, for a line aimed at a rival or a grudge
 * @param botCooldown the least time between two lines by one bot
 * @param window the span the global line budget covers
 * @param maxLinesPerWindow the most lines all bots together say within one window
 * @param minGap the least time between any two lines
 * @param reactionMin the shortest delay between a moment and its line
 * @param reactionMax the longest delay between a moment and its line
 * @param maxDelay a line that the rate limit would push later than this after its moment is dropped
 * @param recentDeath how long after dying a bot may still speak
 * @param tauntEvery the mean time between idle taunt chances; each wait is 0.5x to 1.5x of it
 */
public record ChatSettings(
    Map<Lines.Moment, Double> chances,
    Map<Voice.Verbosity, Double> verbosity,
    double rivalBoost,
    Duration botCooldown,
    Duration window,
    int maxLinesPerWindow,
    Duration minGap,
    Duration reactionMin,
    Duration reactionMax,
    Duration maxDelay,
    Duration recentDeath,
    Duration tauntEvery) {

  public static final double MAX_VERBOSITY_FACTOR = 4;
  public static final double MAX_RIVAL_BOOST = 4;

  public ChatSettings {
    var chanceCopy = new EnumMap<Lines.Moment, Double>(Lines.Moment.class);
    for (var moment : Lines.Moment.values()) {
      var chance = chances.get(moment);
      if (chance == null || !(chance >= 0 && chance <= 1)) {
        throw new IllegalArgumentException(
            "chat chance for " + moment.key() + " must be 0..1: " + chance);
      }
      chanceCopy.put(moment, chance);
    }
    chances = Map.copyOf(chanceCopy);
    var verbosityCopy = new EnumMap<Voice.Verbosity, Double>(Voice.Verbosity.class);
    for (var level : Voice.Verbosity.values()) {
      var factor = verbosity.get(level);
      if (factor == null || !(factor > 0 && factor <= MAX_VERBOSITY_FACTOR)) {
        throw new IllegalArgumentException(
            "chat verbosity factor for " + level + " must be above 0 and at most 4: " + factor);
      }
      verbosityCopy.put(level, factor);
    }
    verbosity = Map.copyOf(verbosityCopy);
    if (!(rivalBoost >= 1 && rivalBoost <= MAX_RIVAL_BOOST)) {
      throw new IllegalArgumentException("chat rivalBoost must be 1..4: " + rivalBoost);
    }
    if (maxLinesPerWindow < 1) {
      throw new IllegalArgumentException("chat maxLinesPerWindow must be at least 1");
    }
    positive("botCooldown", botCooldown);
    positive("window", window);
    positive("minGap", minGap);
    positive("recentDeath", recentDeath);
    positive("tauntEvery", tauntEvery);
    if (reactionMin.isNegative() || reactionMax.compareTo(reactionMin) < 0) {
      throw new IllegalArgumentException(
          "chat reaction must satisfy 0 <= min <= max: " + reactionMin + ", " + reactionMax);
    }
    if (maxDelay.compareTo(reactionMax) < 0) {
      throw new IllegalArgumentException("chat maxDelay must be at least the longest reaction");
    }
  }

  private static void positive(String name, Duration value) {
    if (value.isNegative() || value.isZero()) {
      throw new IllegalArgumentException("chat " + name + " must be positive: " + value);
    }
  }

  public double chance(Lines.Moment moment) {
    return Objects.requireNonNull(chances.get(moment), "every moment has a chance");
  }

  public double verbosity(Voice.Verbosity level) {
    return Objects.requireNonNull(verbosity.get(level), "every verbosity has a factor");
  }
}
