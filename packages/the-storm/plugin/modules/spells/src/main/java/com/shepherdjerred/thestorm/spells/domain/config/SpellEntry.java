package com.shepherdjerred.thestorm.spells.domain.config;

import com.shepherdjerred.thestorm.spells.domain.cast.ReagentCost;
import com.shepherdjerred.thestorm.spells.domain.cast.SpellTerms;
import java.time.Duration;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * One spell's entry in {@code spells.yml}.
 *
 * @param enabled whether it can be cast or bound
 * @param tier the Spellcaster level (1..5) a focus needs
 * @param learned true for quest-only spells, which also need {@code thestorm.spells.learned.<id>}
 * @param reagents what one focus cast consumes, by material name
 * @param cooldownSeconds how long its cooldown group cools down after a cast
 * @param cooldownGroup the cooldown group; spells sharing one share the cooldown and its overlay
 * @param look the focus item's presentation
 * @param fx the cast's particles and sound
 * @param settings the spell's own numbers
 * @param <S> the settings record
 */
public record SpellEntry<S>(
    boolean enabled,
    int tier,
    boolean learned,
    Map<String, Integer> reagents,
    int cooldownSeconds,
    String cooldownGroup,
    SpellLook look,
    SpellFx fx,
    S settings) {

  private static final Pattern GROUP = Pattern.compile("[a-z0-9_]{1,32}");

  public SpellEntry {
    Checks.between("tier", tier, 1, 5);
    reagents.keySet().forEach(material -> Checks.upperName("reagents", material));
    ReagentCost.validate(reagents);
    reagents = Map.copyOf(reagents);
    Checks.between("cooldownSeconds", cooldownSeconds, 1, 86_400);
    if (!GROUP.matcher(cooldownGroup).matches()) {
      throw new IllegalArgumentException(
          "cooldownGroup must match [a-z0-9_]{1,32}: " + cooldownGroup);
    }
  }

  public ReagentCost cost() {
    return new ReagentCost(reagents);
  }

  public Duration cooldown() {
    return Duration.ofSeconds(cooldownSeconds);
  }

  /** The gate-facing view of this entry. */
  public SpellTerms terms() {
    return new SpellTerms(enabled, tier, learned, cost(), cooldownGroup, cooldown());
  }
}
