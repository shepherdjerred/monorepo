package com.shepherdjerred.thestorm.towns.domain.protection;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Limits denial messages so holding a mouse button on a protected block sends one line, not twenty
 * a second. A player hears about a given denial again once {@code cooldownMillis} has passed; a
 * different denial is told at once. Main thread only.
 */
public final class DenialThrottle {

  private final long cooldownMillis;
  private final Map<UUID, Last> last = new HashMap<>();

  public DenialThrottle(long cooldownMillis) {
    if (cooldownMillis < 0) {
      throw new IllegalArgumentException("cooldownMillis must not be negative: " + cooldownMillis);
    }
    this.cooldownMillis = cooldownMillis;
  }

  /** True when {@code player} should be told about {@code denial} at {@code nowMillis}. */
  public boolean shouldTell(UUID player, Denial denial, long nowMillis) {
    var previous = last.get(player);
    if (previous != null
        && previous.denial().equals(denial)
        && nowMillis - previous.atMillis() < cooldownMillis) {
      return false;
    }
    last.put(player, new Last(denial, nowMillis));
    return true;
  }

  /** Forgets {@code player}, for example when they leave. */
  public void forget(UUID player) {
    last.remove(player);
  }

  private record Last(Denial denial, long atMillis) {}
}
