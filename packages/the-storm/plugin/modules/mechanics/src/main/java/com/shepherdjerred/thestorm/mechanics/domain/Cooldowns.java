package com.shepherdjerred.thestorm.mechanics.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Rate limits keyed actions: once a key starts, it cannot start again until the cooldown has
 * passed. Main thread only.
 *
 * @param <K> what is limited, such as a structure's sign position
 */
public final class Cooldowns<K> {

  /** Past this many tracked keys, expired ones are forgotten. */
  private static final int PRUNE_AT = 1024;

  private final Duration cooldown;
  private final Map<K, Instant> readyAt = new HashMap<>();

  public Cooldowns(Duration cooldown) {
    if (cooldown.isNegative() || cooldown.isZero()) {
      throw new IllegalArgumentException("cooldown must be positive: " + cooldown);
    }
    this.cooldown = cooldown;
  }

  /** Starts {@code key} at {@code now} if its cooldown has passed; false if it is still cooling. */
  public boolean tryStart(K key, Instant now) {
    var ready = readyAt.get(key);
    if (ready != null && now.isBefore(ready)) {
      return false;
    }
    if (readyAt.size() >= PRUNE_AT) {
      readyAt.values().removeIf(until -> !now.isBefore(until));
    }
    readyAt.put(key, now.plus(cooldown));
    return true;
  }
}
