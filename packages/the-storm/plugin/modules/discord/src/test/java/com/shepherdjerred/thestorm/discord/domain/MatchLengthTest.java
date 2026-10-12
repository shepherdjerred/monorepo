package com.shepherdjerred.thestorm.discord.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

final class MatchLengthTest {

  @Test
  void showsTheTwoLargestUnits() {
    assertThat(MatchLength.format(Duration.ZERO)).isEqualTo("0s");
    assertThat(MatchLength.format(Duration.ofSeconds(59))).isEqualTo("59s");
    assertThat(MatchLength.format(Duration.ofSeconds(60))).isEqualTo("1m 0s");
    assertThat(MatchLength.format(Duration.ofMinutes(63).plusSeconds(9))).isEqualTo("1h 3m");
  }

  @Test
  void refusesNegativeLengths() {
    assertThatThrownBy(() -> MatchLength.format(Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
