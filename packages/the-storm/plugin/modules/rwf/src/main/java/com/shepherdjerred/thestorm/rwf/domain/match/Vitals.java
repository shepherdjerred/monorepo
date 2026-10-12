package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/**
 * What a tick reports about a living combatant, for the poison.
 *
 * @param position where they stand
 * @param maxHealth their max health
 */
public record Vitals(Vec3 position, double maxHealth) {

  public Vitals {
    if (!(maxHealth > 0)) {
      throw new IllegalArgumentException("maxHealth must be positive");
    }
  }
}
