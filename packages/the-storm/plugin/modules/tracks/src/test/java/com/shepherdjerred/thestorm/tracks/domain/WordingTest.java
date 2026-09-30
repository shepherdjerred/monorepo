package com.shepherdjerred.thestorm.tracks.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

final class WordingTest {

  @ParameterizedTest
  @CsvSource({"1, I", "2, II", "3, III", "4, IV", "5, V"})
  void levelsAreRomanNumerals(int level, String numeral) {
    assertThat(Wording.numeral(level)).isEqualTo(numeral);
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 6})
  void levelsOutsideTheRangeHaveNoNumeral(int level) {
    assertThatThrownBy(() -> Wording.numeral(level)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void waitsRoundUpSoTheyAreNeverShort() {
    assertThat(Wording.wait(Duration.ZERO)).isEqualTo("0s");
    assertThat(Wording.wait(Duration.ofSeconds(-5))).isEqualTo("0s");
    assertThat(Wording.wait(Duration.ofMillis(1))).isEqualTo("1s");
    assertThat(Wording.wait(Duration.ofSeconds(30))).isEqualTo("30s");
    assertThat(Wording.wait(Duration.ofSeconds(59).plusMillis(1))).isEqualTo("1m");
    assertThat(Wording.wait(Duration.ofSeconds(61))).isEqualTo("2m");
    assertThat(Wording.wait(Duration.ofMinutes(59))).isEqualTo("59m");
    assertThat(Wording.wait(Duration.ofMinutes(60))).isEqualTo("1h 0m");
    assertThat(Wording.wait(Duration.ofHours(23).plusMinutes(59).plusSeconds(1)))
        .isEqualTo("24h 0m");
    assertThat(Wording.wait(Duration.ofHours(3).plusMinutes(5))).isEqualTo("3h 5m");
  }
}
