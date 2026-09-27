package com.shepherdjerred.thestorm.skills.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class ExperienceTest {

  @Test
  void curveIsStrictlyIncreasingToOneThousand() {
    assertThat(Experience.required(0)).isZero();
    for (int level = 1; level <= Experience.MAX_LEVEL; level++) {
      long threshold = Experience.required(level);
      assertThat(threshold).isGreaterThan(Experience.required(level - 1));
      assertThat(Experience.level(threshold)).isEqualTo(level);
      assertThat(Experience.level(threshold - 1)).isEqualTo(level - 1);
    }
  }

  @Test
  void awardsCapAtTheFinalThreshold() {
    long cap = Experience.required(Experience.MAX_LEVEL);
    assertThat(Experience.award(cap - 1, 100)).isEqualTo(cap);
    assertThat(Experience.award(cap, 1)).isEqualTo(cap);
    assertThat(Experience.level(Long.MAX_VALUE)).isEqualTo(Experience.MAX_LEVEL);
  }

  @Test
  void invalidValuesFail() {
    assertThatThrownBy(() -> Experience.required(-1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Experience.required(1001))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Experience.level(-1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Experience.award(0, 0)).isInstanceOf(IllegalArgumentException.class);
  }
}
