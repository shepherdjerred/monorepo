package com.shepherdjerred.thestorm.rwfbots.domain.record;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.List;

/**
 * One think step, recorded so a match can be replayed and a decision explained.
 *
 * @param bot who decided
 * @param snapshotTick the tick decided from
 * @param features the inputs that mattered, quantized so traces of equal play hash equal
 * @param utilities the best options and their scores, highest first, at most five
 * @param choice what was picked
 * @param temperature the softmax temperature used
 * @param randomDraw the uniform draw that picked it
 */
public record DecisionTrace(
    CombatantId bot,
    long snapshotTick,
    List<Feature> features,
    List<ScoredOption> utilities,
    Option choice,
    double temperature,
    double randomDraw) {

  public static final int MAX_UTILITIES = 5;

  /** A quantized input, such as {@code health=7} or {@code enemyDistance=12}. */
  public record Feature(String name, int quantized) {

    public Feature {
      if (name.isBlank()) {
        throw new IllegalArgumentException("feature name must not be blank");
      }
    }
  }

  /** An option and its utility. */
  public record ScoredOption(Option option, double score) {}

  public DecisionTrace {
    features = List.copyOf(features);
    utilities = List.copyOf(utilities);
    if (utilities.size() > MAX_UTILITIES) {
      throw new IllegalArgumentException("at most five utilities in a trace");
    }
    for (var i = 1; i < utilities.size(); i++) {
      if (utilities.get(i).score() > utilities.get(i - 1).score()) {
        throw new IllegalArgumentException("utilities must be highest first");
      }
    }
    if (!(randomDraw >= 0 && randomDraw < 1)) {
      throw new IllegalArgumentException("random draw must be in [0, 1): " + randomDraw);
    }
    if (!(temperature > 0)) {
      throw new IllegalArgumentException("temperature must be positive: " + temperature);
    }
  }
}
