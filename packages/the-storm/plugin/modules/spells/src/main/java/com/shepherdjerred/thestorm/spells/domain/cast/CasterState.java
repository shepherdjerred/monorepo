package com.shepherdjerred.thestorm.spells.domain.cast;

import java.time.Duration;
import java.util.Map;

/**
 * What the gates need to know about the caster, gathered by the adapter at cast time.
 *
 * @param tier the caster's Spellcaster level, 0 (untrained) to 5
 * @param learned whether the caster has learned this spell (quest-only spells)
 * @param silenced how long the caster is still silenced; zero when not
 * @param cooldown how long the spell's cooldown group still runs; zero when ready
 * @param held the plain reagents the caster holds, by material name
 */
public record CasterState(
    int tier, boolean learned, Duration silenced, Duration cooldown, Map<String, Integer> held) {

  public CasterState {
    if (tier < 0 || tier > 5) {
      throw new IllegalArgumentException("tier must be 0..5: " + tier);
    }
    held = Map.copyOf(held);
  }
}
