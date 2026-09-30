package com.shepherdjerred.thestorm.essentials.domain.config;

import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricing;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequests;
import java.time.Duration;

/**
 * How teleports behave.
 *
 * @param warmup how long a player stands still before a teleport happens; zero teleports at once
 * @param tpaTimeout how long a {@code /tpa} or {@code /tpahere} request stays open
 * @param tpaInterval the least time between two requests from one player
 * @param backHistorySize how many places {@code /back} remembers per player
 * @param pricing cost, cooldown and multiplier rules
 */
public record TeleportSettings(
    Duration warmup,
    Duration tpaTimeout,
    Duration tpaInterval,
    int backHistorySize,
    TeleportPricing pricing) {

  /** The most places {@code /back} may remember. */
  public static final int MAX_BACK_HISTORY = 50;

  public TeleportSettings {
    if (warmup.isNegative()) {
      throw new IllegalArgumentException("warmup must not be negative: " + warmup);
    }
    new TpaRequests.Rules(tpaTimeout, tpaInterval);
    if (backHistorySize < 1 || backHistorySize > MAX_BACK_HISTORY) {
      throw new IllegalArgumentException("backHistorySize must be 1-" + MAX_BACK_HISTORY);
    }
  }

  /** The request rules for {@link TpaRequests}. */
  public TpaRequests.Rules tpaRules() {
    return new TpaRequests.Rules(tpaTimeout, tpaInterval);
  }
}
