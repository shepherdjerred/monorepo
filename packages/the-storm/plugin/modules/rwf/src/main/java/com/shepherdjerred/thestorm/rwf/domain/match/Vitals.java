package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/**
 * What a tick reports about a living combatant: for the poison, the start spawns and the credit for
 * a kill the rules deal.
 *
 * @param position where they stand
 * @param maxHealth their max health
 * @param health their health now
 */
public record Vitals(Vec3 position, double maxHealth, double health) {

  public Vitals {
    if (!(maxHealth > 0)) {
      throw new IllegalArgumentException("maxHealth must be positive");
    }
    if (!(health >= 0)) {
      throw new IllegalArgumentException("health must not be negative");
    }
  }

  /** A combatant at full health. */
  public Vitals(Vec3 position, double maxHealth) {
    this(position, maxHealth, maxHealth);
  }
}
