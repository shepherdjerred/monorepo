package com.shepherdjerred.thestorm.arena.domain.survival;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** A small recovery floor; food, class healing and potions supply the rest. */
public final class PassiveRecovery {
  private final Map<UUID, Instant> nextHeal = new HashMap<>();

  public void hurt(UUID player, Instant now) {
    nextHeal.put(player, now.plusSeconds(8));
  }

  public double recover(UUID player, Instant now, double health, double maxHealth) {
    if (!Double.isFinite(health) || !Double.isFinite(maxHealth) || health < 0 || maxHealth <= 0) {
      throw new IllegalArgumentException("Invalid survivor health");
    }
    var ceiling = maxHealth / 3;
    if (health == 0
        || health >= ceiling
        || now.isBefore(nextHeal.getOrDefault(player, Instant.MIN))) {
      return health;
    }
    nextHeal.put(player, now.plusSeconds(5));
    return Math.min(ceiling, health + 1);
  }

  public void remove(UUID player) {
    nextHeal.remove(player);
  }

  public void reset() {
    nextHeal.clear();
  }
}
