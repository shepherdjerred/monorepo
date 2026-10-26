package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;

/** A flat price and cooldown for each teleport command. */
public record TeleportPricing(TeleportPrices prices, Duration rtpFreeFor) {

  public TeleportPricing {
    if (rtpFreeFor.isNegative()) {
      throw new IllegalArgumentException("RTP free period must not be negative: " + rtpFreeFor);
    }
  }
}
