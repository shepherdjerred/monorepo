package com.shepherdjerred.thestorm.towns.domain.lock;

/**
 * How locks behave, from {@code towns.yml}.
 *
 * @param maxPerPlayer the most locks one player may hold, automatic ones included; a double chest
 *     counts once
 * @param autoLockOnPlace true when every container a player places is locked for them at once, so
 *     building is safe by default and {@code /unlock} makes one public
 */
public record LockPolicy(int maxPerPlayer, boolean autoLockOnPlace) {

  public LockPolicy {
    if (maxPerPlayer < 1) {
      throw new IllegalArgumentException("maxPerPlayer must be at least 1");
    }
  }
}
