package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import java.util.UUID;

/** A response can control only the body, life and observation it was produced for. */
public record ActionTicket(
    UUID match, UUID body, int life, long tick, double yaw, CombatAction action) {
  public ActionTicket {
    if (life < 0 || tick < 0 || !Double.isFinite(yaw))
      throw new IllegalArgumentException("invalid action context");
  }

  public boolean applies(UUID currentMatch, UUID currentBody, int currentLife, long currentTick) {
    return match.equals(currentMatch)
        && body.equals(currentBody)
        && life == currentLife
        && currentTick >= tick
        && currentTick - tick <= 2;
  }
}
