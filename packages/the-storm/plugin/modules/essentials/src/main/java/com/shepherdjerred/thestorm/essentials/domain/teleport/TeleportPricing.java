package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;

/**
 * How teleports are priced, as in stTeleports (2017): each use raises that kind's multiplier by
 * {@code multiplierGrowth}, and every {@code decayEvery} without a use lowers it by {@code
 * multiplierDecay}, never below ×1 or above {@code maxMultiplier}. Cost and cooldown are both the
 * base value times the multiplier in force when the teleport is taken.
 *
 * @param prices base cost and cooldown per kind
 * @param multiplierGrowth added to the multiplier per use, for example {@code 0.5}
 * @param multiplierDecay removed from the multiplier per elapsed {@code decayEvery}
 * @param decayEvery how often the multiplier decays
 * @param maxMultiplier the ceiling, for example {@code 4.0}
 */
public record TeleportPricing(
    TeleportPrices prices,
    double multiplierGrowth,
    double multiplierDecay,
    Duration decayEvery,
    double maxMultiplier) {

  public TeleportPricing {
    Multiplier.hundredthsOf(multiplierGrowth);
    Multiplier.hundredthsOf(multiplierDecay);
    Multiplier.of(maxMultiplier);
    if (decayEvery.isNegative() || decayEvery.isZero()) {
      throw new IllegalArgumentException("decayEvery must be positive: " + decayEvery);
    }
  }

  /** {@link #multiplierGrowth} in hundredths. */
  public long growthStep() {
    return Multiplier.hundredthsOf(multiplierGrowth);
  }

  /** {@link #multiplierDecay} in hundredths. */
  public long decayStep() {
    return Multiplier.hundredthsOf(multiplierDecay);
  }

  /** {@link #maxMultiplier} as a multiplier. */
  public Multiplier cap() {
    return Multiplier.of(maxMultiplier);
  }
}
