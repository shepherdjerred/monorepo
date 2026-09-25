package com.shepherdjerred.thestorm.qol.domain.rtp;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * Free for a window after first seen, then a flat crystal cost. The cooldown applies either way.
 */
public final class RtpPricing {

  private final Duration freeFor;
  private final Duration cooldown;
  private final long cost;

  public RtpPricing(Duration freeFor, Duration cooldown, long cost) {
    if (freeFor.isZero() || freeFor.isNegative() || cooldown.isZero() || cooldown.isNegative()) {
      throw new IllegalArgumentException("free window and cooldown must be positive");
    }
    if (cost < 0) {
      throw new IllegalArgumentException("cost must not be negative: " + cost);
    }
    this.freeFor = freeFor;
    this.cooldown = cooldown;
    this.cost = cost;
  }

  /**
   * What {@code now} allows, given when the player was first seen and when they last teleported.
   */
  public RtpDecision decide(Instant firstSeen, Optional<Instant> lastRtp, Instant now) {
    if (lastRtp.isPresent() && now.isBefore(lastRtp.get().plus(cooldown))) {
      return new RtpDecision.CoolingDown(Duration.between(now, lastRtp.get().plus(cooldown)));
    }
    if (now.isBefore(firstSeen.plus(freeFor))) {
      return new RtpDecision.Free();
    }
    return new RtpDecision.Priced(cost);
  }
}
