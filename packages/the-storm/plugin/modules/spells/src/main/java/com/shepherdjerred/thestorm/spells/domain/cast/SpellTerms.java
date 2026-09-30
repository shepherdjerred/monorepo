package com.shepherdjerred.thestorm.spells.domain.cast;

import java.time.Duration;

/**
 * What a spell asks of its caster, from {@code spells.yml}.
 *
 * @param enabled whether the spell may be cast at all
 * @param tier the Spellcaster level (1..5) a focus needs
 * @param learned whether the spell is quest-only and must also be learned
 * @param cost the reagents a focus cast consumes
 * @param cooldownGroup the cooldown group the spell starts
 * @param cooldown how long that group cools down after a cast
 */
public record SpellTerms(
    boolean enabled,
    int tier,
    boolean learned,
    ReagentCost cost,
    String cooldownGroup,
    Duration cooldown) {

  public SpellTerms {
    if (tier < 1 || tier > 5) {
      throw new IllegalArgumentException("tier must be 1..5: " + tier);
    }
    if (cooldown.isNegative()) {
      throw new IllegalArgumentException("cooldown cannot be negative: " + cooldown);
    }
  }
}
