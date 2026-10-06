package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Instant;

/** A successful trip's time and weight, captured when it completes. */
public record TeleportUse(Instant at, int halfPoints) {
  public TeleportUse {
    if (halfPoints <= 0) {
      throw new IllegalArgumentException("a trip must consume positive half-points");
    }
  }
}
