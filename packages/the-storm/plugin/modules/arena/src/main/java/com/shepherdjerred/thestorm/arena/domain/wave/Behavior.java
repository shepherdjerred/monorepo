package com.shepherdjerred.thestorm.arena.domain.wave;

/** How an arena mob behaves beyond its vanilla AI. */
public enum Behavior {
  /** Vanilla AI only. */
  VANILLA,
  /** Always hunts the nearest fighter, even ones it cannot see. */
  CHASE,
  /** Hunts the nearest fighter and explodes when it reaches them. */
  KAMIKAZE,
  /** Harmless: trails the nearest fighter and does nothing else (the rainbow sheep). */
  FOLLOW,
}
