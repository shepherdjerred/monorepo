package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Random;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class Lcg48Test {

  @ParameterizedTest
  @ValueSource(longs = {0L, 1L, 1731L, -8_675_309L, Long.MAX_VALUE, Long.MIN_VALUE})
  void reproducesJavaUtilRandomForTheCallsBetaNoiseMakes(long seed) {
    // The reference implementation the port must agree with, seeded identically.
    var reference = new Random(seed);
    var port = new Lcg48(seed);

    for (var i = 0; i < 2_000; i++) {
      assertThat(port.nextDouble()).isEqualTo(reference.nextDouble());
      var bound = 256 - (i % 256);
      assertThat(port.nextInt(bound)).isEqualTo(reference.nextInt(bound));
      assertThat(port.nextInt(1 << (i % 31))).isEqualTo(reference.nextInt(1 << (i % 31)));
      assertThat(port.nextInt(Integer.MAX_VALUE - i))
          .isEqualTo(reference.nextInt(Integer.MAX_VALUE - i));
    }
  }

  @ParameterizedTest
  @ValueSource(ints = {0, -1})
  void rejectsBoundsJavaUtilRandomRejects(int bound) {
    assertThatThrownBy(() -> new Lcg48(0).nextInt(bound))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
