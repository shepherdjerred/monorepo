package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.EnumMap;
import java.util.Map;
import java.util.random.RandomGenerator;

/**
 * Picks an option in proportion to {@code exp(score / temperature)}. As the temperature goes to
 * zero this becomes the argmax (ties go to the first option in declaration order); at one it is a
 * gentle preference.
 */
public final class Softmax {

  /** Below this temperature the choice is the plain argmax, avoiding overflow. */
  public static final double ARGMAX_BELOW = 1.0e-3;

  private Softmax() {}

  /**
   * One selection.
   *
   * @param choice what was picked
   * @param draw the uniform draw in [0, 1) that picked it
   * @param probabilities the probability of each scored option
   */
  public record Pick(Option choice, double draw, Map<Option, Double> probabilities) {

    public Pick {
      probabilities = Map.copyOf(probabilities);
    }
  }

  /** Selects from {@code scores}, which must not be empty, at {@code temperature}. */
  public static Pick select(
      Map<Option, Double> scores, double temperature, RandomGenerator random) {
    if (scores.isEmpty()) {
      throw new IllegalArgumentException("nothing to choose from");
    }
    if (!(temperature > 0)) {
      throw new IllegalArgumentException("temperature must be positive: " + temperature);
    }
    var ordered = new EnumMap<>(scores);
    var draw = random.nextDouble();
    var probabilities = probabilities(ordered, temperature);
    var cumulative = 0.0;
    var last = ordered.keySet().iterator().next();
    for (var entry : probabilities.entrySet()) {
      cumulative += entry.getValue();
      last = entry.getKey();
      if (draw < cumulative) {
        return new Pick(entry.getKey(), draw, probabilities);
      }
    }
    return new Pick(last, draw, probabilities);
  }

  /** The softmax probabilities of {@code scores} at {@code temperature}, in option order. */
  public static EnumMap<Option, Double> probabilities(
      EnumMap<Option, Double> scores, double temperature) {
    var max = scores.values().stream().mapToDouble(Double::doubleValue).max().orElseThrow();
    var probabilities = new EnumMap<Option, Double>(Option.class);
    if (temperature < ARGMAX_BELOW) {
      var winner = scores.entrySet().stream().filter(e -> e.getValue() == max).findFirst();
      scores.forEach((option, score) -> probabilities.put(option, 0.0));
      probabilities.put(winner.orElseThrow().getKey(), 1.0);
      return probabilities;
    }
    var total = 0.0;
    for (var entry : scores.entrySet()) {
      var weight = Math.exp((entry.getValue() - max) / temperature);
      probabilities.put(entry.getKey(), weight);
      total += weight;
    }
    for (var entry : probabilities.entrySet()) {
      entry.setValue(entry.getValue() / total);
    }
    return probabilities;
  }
}
