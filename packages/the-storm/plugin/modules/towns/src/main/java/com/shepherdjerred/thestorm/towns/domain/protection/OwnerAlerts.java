package com.shepherdjerred.thestorm.towns.domain.protection;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * One notice to a land owner per visitor per minute. Holding a door open must not fill their chat.
 * Main thread only.
 */
public final class OwnerAlerts {

  public static final long COOLDOWN_MILLIS = 60_000;

  private final long cooldownMillis;
  private final Map<Pair, Long> last = new HashMap<>();

  public OwnerAlerts(long cooldownMillis) {
    if (cooldownMillis < 0) {
      throw new IllegalArgumentException("cooldownMillis must not be negative: " + cooldownMillis);
    }
    this.cooldownMillis = cooldownMillis;
  }

  /** True when {@code owner} should hear about {@code visitor} at {@code nowMillis}. */
  public boolean shouldTell(UUID owner, UUID visitor, long nowMillis) {
    var key = new Pair(owner, visitor);
    var previous = last.get(key);
    if (previous != null && nowMillis - previous < cooldownMillis) {
      return false;
    }
    last.put(key, nowMillis);
    return true;
  }

  /** Forgets {@code player} as either party, for example when they leave. */
  public void forget(UUID player) {
    last.keySet().removeIf(pair -> pair.owner().equals(player) || pair.visitor().equals(player));
  }

  private record Pair(UUID owner, UUID visitor) {}
}
