package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;

/** One rolling allowance and escalation policy for every command teleport. */
public record TeleportPricing(
    TeleportPrices prices,
    Duration window,
    double allowance,
    double maxMultiplier,
    Duration rtpFreeFor) {

  public TeleportPricing {
    if (window.isZero() || window.isNegative() || rtpFreeFor.isNegative()) {
      throw new IllegalArgumentException(
          "window must be positive and RTP free period non-negative");
    }
    if (!Double.isFinite(allowance)
        || allowance < 0
        || allowance * 2 != Math.rint(allowance * 2)
        || allowance > Integer.MAX_VALUE / 2.0) {
      throw new IllegalArgumentException(
          "allowance must be a non-negative multiple of half a point");
    }
    Multiplier.of(maxMultiplier);
  }

  public int allowanceHalfPoints() {
    return (int) (allowance * 2);
  }
}
