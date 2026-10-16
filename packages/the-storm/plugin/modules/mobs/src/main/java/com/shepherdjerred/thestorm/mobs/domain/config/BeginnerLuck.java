package com.shepherdjerred.thestorm.mobs.domain.config;

import java.time.Duration;

/** Wilderness difficulty measured in durable active milliseconds since rollout activation. */
public record BeginnerLuck(
    Duration calmFor,
    Duration normalAfter,
    double initialDamageMultiplier,
    int startingLevel,
    double radius) {

  public BeginnerLuck {
    if (startingLevel < 1 || !Double.isFinite(radius) || radius <= 0 || radius > 128) {
      throw new IllegalArgumentException("startingLevel must be positive and radius must be 0-128");
    }
    if (calmFor.isNegative() || normalAfter.toMillis() <= calmFor.toMillis()) {
      throw new IllegalArgumentException(
          "normalAfter must exceed non-negative calmFor by at least a millisecond");
    }
    if (!Double.isFinite(initialDamageMultiplier)
        || initialDamageMultiplier < 0
        || initialDamageMultiplier > 1) {
      throw new IllegalArgumentException("initialDamageMultiplier must be between 0 and 1");
    }
  }

  /** Zero during the calm period, rising linearly to one at normalAfter. */
  public double progress(long activeMillis) {
    if (activeMillis < 0) throw new IllegalArgumentException("activeMillis must be non-negative");
    return Math.clamp(
        (activeMillis - calmFor.toMillis())
            / (double) (normalAfter.toMillis() - calmFor.toMillis()),
        0,
        1);
  }

  public double damageMultiplier(long activeMillis) {
    return initialDamageMultiplier + (1 - initialDamageMultiplier) * progress(activeMillis);
  }

  /** Combat uses level one initially and gradually restores the mob's actual level. */
  public int effectiveLevel(int actualLevel, long activeMillis) {
    if (actualLevel < 1) throw new IllegalArgumentException("actualLevel must be positive");
    var start = Math.min(startingLevel, actualLevel);
    return start + (int) Math.floor((actualLevel - start) * progress(activeMillis));
  }
}
