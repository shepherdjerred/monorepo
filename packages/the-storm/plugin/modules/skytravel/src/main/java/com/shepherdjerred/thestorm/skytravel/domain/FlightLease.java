package com.shepherdjerred.thestorm.skytravel.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * Absolute deadlines survive disconnects/restarts; neither recovery nor flag changes extend them.
 */
public record FlightLease(
    UUID player,
    Phase phase,
    Instant assistedUntil,
    Instant protectedUntil,
    Instant cooldownUntil) {
  public enum Phase {
    ASCENT,
    GLIDE,
    DESCENT,
    ENDED
  }

  public FlightLease {
    if (protectedUntil.isBefore(assistedUntil)
        || protectedUntil.isAfter(assistedUntil.plusSeconds(30))
        || cooldownUntil.isAfter(assistedUntil))
      throw new IllegalArgumentException("Invalid flight deadlines");
  }

  public boolean assisted(Instant now) {
    return (phase == Phase.ASCENT || phase == Phase.GLIDE) && now.isBefore(assistedUntil);
  }

  public boolean protectedFromFall(Instant now) {
    return phase != Phase.ENDED && now.isBefore(protectedUntil);
  }

  public FlightLease phase(Phase next) {
    return new FlightLease(player, next, assistedUntil, protectedUntil, cooldownUntil);
  }
}
