package com.shepherdjerred.thestorm.skills.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class SkillPerksTest {

  @Test
  void passivesAreBoundedAndStartAtVanilla() {
    assertThat(SkillPerks.extraDropChance(0)).isZero();
    assertThat(SkillPerks.extraDropChance(1000)).isEqualTo(0.25);
    assertThat(SkillPerks.combatDamageMultiplier(0)).isEqualTo(1.0);
    assertThat(SkillPerks.combatDamageMultiplier(1000)).isEqualTo(1.1);
    assertThat(SkillPerks.fallDamageMultiplier(0)).isEqualTo(1.0);
    assertThat(SkillPerks.fallDamageMultiplier(1000)).isEqualTo(0.75);
  }

  @Test
  void levelsOutsideTheCurveAreRejected() {
    assertThatThrownBy(() -> SkillPerks.extraDropChance(-1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> SkillPerks.combatDamageMultiplier(1001))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
