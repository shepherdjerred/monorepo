package com.shepherdjerred.thestorm.spells.domain.cast;

/** How a spell is cast. */
public enum CastMode {
  /**
   * A reusable focus bound to the caster: needs the spell's tier (and learning, for quest-only
   * spells) and costs reagents.
   */
  FOCUS,
  /**
   * A single-use scroll: anyone may read it, and the scroll itself is the cost. Cooldowns, silences
   * and protection still apply.
   */
  SCROLL
}
