package com.shepherdjerred.thestorm.arena.domain.wave;

import java.time.Duration;
import java.util.Optional;

/**
 * One boss ability and its tuning. See {@link AbilityType} for what each parameter means per type.
 *
 * @param type the ability
 * @param cooldown the time between uses; the first use comes one cooldown after the boss spawns
 * @param radius the reach in blocks
 * @param power damage, strength, seconds or a fraction, depending on the type
 * @param count jumps, adds or heart hits, depending on the type
 * @param summon the archetype {@link AbilityType#SUMMON_ADDS} summons
 */
public record AbilitySpec(
    AbilityType type,
    Duration cooldown,
    double radius,
    double power,
    int count,
    Optional<String> summon) {

  private static final Duration SHORTEST = Duration.ofSeconds(1);

  public AbilitySpec {
    if (cooldown.compareTo(SHORTEST) < 0) {
      throw new IllegalArgumentException("cooldown must be at least 1 second: " + cooldown);
    }
    var uses = Uses.of(type);
    require(uses.radius(), radius > 0 && radius <= 64, radius == 0, "radius 1 to 64");
    require(
        uses.power(),
        power > 0 && power <= uses.maxPower(),
        power == 0,
        "power above 0 and at most " + uses.maxPower());
    require(uses.count(), count >= 1 && count <= 20, count == 0, "count 1 to 20");
    require(uses.summon(), summon.isPresent(), summon.isEmpty(), "summon naming an archetype");
  }

  /**
   * Checks one parameter: when the type uses it, it must be valid; otherwise it must be unset. The
   * rule starts with the parameter's name.
   */
  private static void require(boolean used, boolean validWhenUsed, boolean unset, String rule) {
    if (used && !validWhenUsed) {
      throw new IllegalArgumentException("this ability needs " + rule);
    }
    if (!used && !unset) {
      var parameter = rule.substring(0, rule.indexOf(' '));
      throw new IllegalArgumentException(
          "this ability does not use " + parameter + "; set it to 0 (or null for summon)");
    }
  }

  /** Which parameters a type reads, and the largest power it accepts. */
  private record Uses(
      boolean radius, boolean power, double maxPower, boolean count, boolean summon) {

    static Uses of(AbilityType type) {
      return switch (type) {
        case LIGHTNING_AURA, DISORIENT, KNOCKBACK_SLAM, SHIELD_BREAK ->
            new Uses(true, true, 40, false, false);
        case CHAIN_LIGHTNING -> new Uses(true, true, 40, true, false);
        case SUMMON_ADDS -> new Uses(false, false, 0, true, true);
        case HEART -> new Uses(false, true, 1, true, false);
      };
    }
  }
}
