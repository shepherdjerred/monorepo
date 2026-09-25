package com.shepherdjerred.thestorm.spells.domain.cast;

/** One attempt to cast (or bind) a spell, as the gates see it. */
public record CastAttempt(CastMode mode, SpellTerms terms, CasterState caster) {

  /** True for a focus: the caster must know the spell and pay reagents. */
  public boolean usesFocus() {
    return mode == CastMode.FOCUS;
  }
}
