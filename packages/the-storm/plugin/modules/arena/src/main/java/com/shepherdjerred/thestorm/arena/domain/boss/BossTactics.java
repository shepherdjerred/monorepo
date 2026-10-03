package com.shepherdjerred.thestorm.arena.domain.boss;

import com.shepherdjerred.thestorm.arena.domain.wave.AbilitySpec;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilityType;
import java.time.Duration;
import java.util.List;

/** A fixed-party encounter gains pressure in its final phase without instant, stacked casts. */
public final class BossTactics {
  private BossTactics() {}

  public static List<AbilitySpec> abilities(List<AbilitySpec> base, int players, boolean enraged) {
    if (players < 1 || players > 4) {
      throw new IllegalArgumentException("boss parties must have 1-4 fighters");
    }
    return base.stream()
        .map(
            ability -> {
              var count =
                  switch (ability.type()) {
                    case SUMMON_ADDS ->
                        Math.min(
                            20,
                            (int) Math.ceil(ability.count() * (1 + (players - 1) * 0.5))
                                + (enraged ? 1 : 0));
                    case HEART -> Math.min(20, ability.count() + players - 1);
                    default -> ability.count();
                  };
              var cooldown =
                  enraged && ability.type() != AbilityType.HEART
                      ? Duration.ofMillis(Math.max(3000, ability.cooldown().toMillis() * 3 / 4))
                      : ability.cooldown();
              return new AbilitySpec(
                  ability.type(),
                  cooldown,
                  ability.radius(),
                  ability.power(),
                  count,
                  ability.summon());
            })
        .toList();
  }

  public static String warning(AbilityType type) {
    return switch (type) {
      case LIGHTNING_AURA -> "Lightning storm — leave the marked circle!";
      case CHAIN_LIGHTNING -> "Chain lightning — spread out and get away!";
      case DISORIENT -> "Hex — leave the marked circle!";
      case SUMMON_ADDS -> "Reinforcements incoming!";
      case KNOCKBACK_SLAM -> "Ground slam — leave the marked circle!";
      case SHIELD_BREAK -> "Shield shatter — leave the marked circle!";
      case HEART -> "The heart is moving!";
    };
  }
}
