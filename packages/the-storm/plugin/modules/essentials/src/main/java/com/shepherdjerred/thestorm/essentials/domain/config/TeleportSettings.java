package com.shepherdjerred.thestorm.essentials.domain.config;

import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricing;
import java.time.Duration;

/**
 * How teleports behave.
 *
 * @param warmup how long a player stands still before a teleport happens; zero teleports at once
 * @param tpaTimeout how long a {@code /tpa} or {@code /tpahere} request stays open
 * @param backHistorySize how many places {@code /back} remembers per player
 * @param pricing cost, cooldown and multiplier rules
 */
public record TeleportSettings(
    Duration warmup, Duration tpaTimeout, int backHistorySize, TeleportPricing pricing) {

  /** The most places {@code /back} may remember. */
  public static final int MAX_BACK_HISTORY = 50;

  public TeleportSettings {
    if (warmup.isNegative()) {
      throw new IllegalArgumentException("warmup must not be negative: " + warmup);
    }
    if (tpaTimeout.isNegative() || tpaTimeout.isZero()) {
      throw new IllegalArgumentException("tpaTimeout must be positive: " + tpaTimeout);
    }
    if (backHistorySize < 1 || backHistorySize > MAX_BACK_HISTORY) {
      throw new IllegalArgumentException("backHistorySize must be 1-" + MAX_BACK_HISTORY);
    }
  }
}
