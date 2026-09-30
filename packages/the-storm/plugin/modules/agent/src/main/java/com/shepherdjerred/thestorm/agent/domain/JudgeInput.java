package com.shepherdjerred.thestorm.agent.domain;

import java.util.Optional;

/**
 * One classification ready for the ladder: what the offense is, how sure the classifier was, the
 * bar it must clear, and the player's strikes.
 *
 * @param offense what was found, or empty when the line was clean
 * @param confidence how sure the classifier was, 0-1
 * @param threshold the confidence that acts, 0-1
 * @param strikes the player's strikes for the offense inside the ladder window
 */
public record JudgeInput(
    Optional<Offense> offense, double confidence, double threshold, int strikes) {

  public JudgeInput {
    if (!(confidence >= 0 && confidence <= 1)) {
      throw new IllegalArgumentException("confidence must be 0-1");
    }
    if (!(threshold >= 0 && threshold <= 1)) {
      throw new IllegalArgumentException("threshold must be 0-1");
    }
    if (strikes < 0) {
      throw new IllegalArgumentException("strikes must not be negative");
    }
  }
}
