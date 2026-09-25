package com.shepherdjerred.thestorm.world.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Half the awake players, which is what world.yml sets. */
final class SleepFractionTest {

  @Test
  void oneOfOneOrTwoSkipsAndOneOfThreeDoesNot() {
    assertThat(SleepFraction.skips(1, 1, 50)).isTrue();
    assertThat(SleepFraction.skips(1, 2, 50)).isTrue();
    assertThat(SleepFraction.skips(1, 3, 50)).isFalse();
    assertThat(SleepFraction.skips(2, 3, 50)).isTrue();
  }
}
