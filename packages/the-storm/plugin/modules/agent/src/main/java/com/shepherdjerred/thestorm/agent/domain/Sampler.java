package com.shepherdjerred.thestorm.agent.domain;

import java.util.random.RandomGenerator;

/**
 * Deals autonomous decisions into the spot-check queue. Every recorded decision is sampled at the
 * configured rate, watched or acted, so reviewers see what the agent did and what it would have
 * done. The edges are exact: 0 samples nothing without touching the generator, 100 samples
 * everything.
 */
public final class Sampler {

  private Sampler() {}

  /** Whether a decision joins the spot-check queue at {@code percent} in a hundred. */
  public static boolean shouldSample(RandomGenerator random, int percent) {
    if (percent <= 0) {
      return false;
    }
    if (percent >= 100) {
      return true;
    }
    return random.nextDouble(100.0) < percent;
  }
}
