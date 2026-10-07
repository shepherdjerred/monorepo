package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import java.util.random.RandomGenerator;

/** Stable independent categorical sampling in the shared move/jump/sneak/sprint/attack order. */
public final class CategoricalActions {
  private CategoricalActions() {}

  public static CombatAction sample(float[] logits, RandomGenerator random) {
    if (logits.length != 17) throw new IllegalArgumentException("wrong combat logit count");
    for (var logit : logits) {
      if (!Float.isFinite(logit)) throw new IllegalArgumentException("nonfinite action logit");
    }
    return new CombatAction(
        choose(logits, 0, 9, random),
        choose(logits, 9, 2, random) == 1,
        choose(logits, 11, 2, random) == 1,
        choose(logits, 13, 2, random) == 1,
        choose(logits, 15, 2, random) == 1);
  }

  private static int choose(float[] logits, int offset, int size, RandomGenerator random) {
    double maximum = logits[offset];
    for (var index = 1; index < size; index++) maximum = Math.max(maximum, logits[offset + index]);
    var weights = new double[size];
    double total = 0;
    for (var index = 0; index < size; index++) {
      weights[index] = Math.exp(logits[offset + index] - maximum);
      total += weights[index];
    }
    var draw = random.nextDouble() * total;
    for (var index = 0; index < size; index++) {
      draw -= weights[index];
      if (draw < 0) return index;
    }
    // Roundoff at the cumulative upper boundary selects the final category.
    return size - 1;
  }
}
