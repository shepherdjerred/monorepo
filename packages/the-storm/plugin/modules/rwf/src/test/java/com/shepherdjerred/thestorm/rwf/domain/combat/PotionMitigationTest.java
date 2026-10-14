package com.shepherdjerred.thestorm.rwf.domain.combat;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class PotionMitigationTest {
  @Test
  void resistanceReducesCustomHitsOnceWithoutAffectingInstantDeathOrVoid() {
    assertThat(PotionMitigation.resistance(10, -1, AttackType.MELEE)).isEqualTo(10);
    assertThat(PotionMitigation.resistance(10, 0, AttackType.MELEE)).isEqualTo(8);
    assertThat(PotionMitigation.resistance(10, 1, AttackType.EXPLOSION)).isEqualTo(6);
    assertThat(PotionMitigation.resistance(10, 4, AttackType.MELEE)).isZero();
    assertThat(PotionMitigation.resistance(10, 0, AttackType.BOMB_EXPLODE)).isEqualTo(10);
    assertThat(PotionMitigation.resistance(10, 0, AttackType.VOID)).isEqualTo(10);
  }
}
