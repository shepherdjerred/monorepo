package com.shepherdjerred.thestorm.towns.domain.pvp;

import java.time.Duration;

/**
 * How often players may change their own PvP switch, from {@code towns.yml}.
 *
 * @param toggleCooldownHours how long after a change the next may be made
 * @param combatLockSeconds how long after dealing or taking PvP damage a player may not change it,
 *     so nobody escapes a fight they are losing
 */
public record PvpPolicy(long toggleCooldownHours, long combatLockSeconds) {

  public PvpPolicy {
    if (toggleCooldownHours < 0) {
      throw new IllegalArgumentException("toggleCooldownHours must not be negative");
    }
    if (combatLockSeconds < 0) {
      throw new IllegalArgumentException("combatLockSeconds must not be negative");
    }
  }

  public Duration cooldown() {
    return Duration.ofHours(toggleCooldownHours);
  }

  public Duration combatLock() {
    return Duration.ofSeconds(combatLockSeconds);
  }
}
