package com.shepherdjerred.thestorm.arena.domain.wave;

/**
 * A boss ability. What {@code radius}, {@code power} and {@code count} mean depends on the type;
 * parameters a type does not use must be 0.
 */
public enum AbilityType {
  /** Lightning strikes every fighter within {@code radius}, dealing {@code power} damage. */
  LIGHTNING_AURA,
  /**
   * Lightning hits the nearest fighter within {@code radius}, then jumps up to {@code count} more
   * times to the nearest fighter within {@code radius} of the last one, {@code power} damage each.
   */
  CHAIN_LIGHTNING,
  /** Fighters within {@code radius} get nausea and slowness for {@code power} seconds. */
  DISORIENT,
  /** Summons {@code count} of the {@code summon} archetype around the boss. */
  SUMMON_ADDS,
  /**
   * Hurls fighters within {@code radius} away with strength {@code power} and deals twice {@code
   * power} damage.
   */
  KNOCKBACK_SLAM,
  /** Disables the shields of fighters within {@code radius} for {@code power} seconds. */
  SHIELD_BREAK,
  /**
   * The Creaking's heart: the boss takes no damage; fighters must hit its heart {@code count} times
   * to break it, which costs the boss {@code power} of its max health. The heart moves to another
   * mob spawn every cooldown.
   */
  HEART,
}
