package com.shepherdjerred.thestorm.mechanics.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

final class CooldownsTest {

  private static final Instant START = Instant.parse("2026-09-25T12:00:00Z");

  @Test
  void aKeyWaitsOutItsCooldown() {
    var cooldowns = new Cooldowns<String>(Duration.ofSeconds(1));

    assertThat(cooldowns.tryStart("bridge", START)).isTrue();
    assertThat(cooldowns.tryStart("bridge", START.plusMillis(999))).isFalse();
    assertThat(cooldowns.tryStart("bridge", START.plusSeconds(1))).isTrue();
  }

  @Test
  void keysAreIndependent() {
    var cooldowns = new Cooldowns<String>(Duration.ofSeconds(1));

    assertThat(cooldowns.tryStart("bridge", START)).isTrue();
    assertThat(cooldowns.tryStart("gate", START)).isTrue();
  }

  @Test
  void manyExpiredKeysAreForgotten() {
    var cooldowns = new Cooldowns<Integer>(Duration.ofSeconds(1));
    for (var key = 0; key < 2000; key++) {
      assertThat(cooldowns.tryStart(key, START)).isTrue();
    }

    assertThat(cooldowns.tryStart(0, START.plusSeconds(2))).isTrue();
    assertThat(cooldowns.tryStart(0, START.plusSeconds(2))).isFalse();
  }

  @Test
  void aCooldownMustBePositive() {
    assertThatThrownBy(() -> new Cooldowns<String>(Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
