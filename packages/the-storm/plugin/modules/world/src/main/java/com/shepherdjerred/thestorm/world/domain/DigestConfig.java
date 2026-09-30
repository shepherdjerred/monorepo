package com.shepherdjerred.thestorm.world.domain;

import java.time.ZoneId;

/** A read-only main-world daily ledger under the crier command. */
public record DigestConfig(boolean enabled, String world, String timeZone) {

  public DigestConfig {
    if (!"world".equals(world)) {
      throw new IllegalArgumentException("the daily digest is restricted to the main world");
    }
    ZoneId.of(timeZone);
  }

  public ZoneId zone() {
    return ZoneId.of(timeZone);
  }
}
