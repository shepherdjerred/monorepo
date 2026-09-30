package com.shepherdjerred.thestorm.qol.domain.text;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class DurationTextTest {

  @ParameterizedTest
  @CsvSource({
    "PT0S, 0s",
    "PT0.001S, 1s",
    "PT14.2S, 15s",
    "PT59S, 59s",
    "PT1M, 1m",
    "PT12M5S, 12m 5s",
    "PT15M, 15m",
    "PT1H, 1h",
    "PT3H20M, 3h 20m",
    "PT3H20M30S, 3h 20m",
    "PT24H, 1d",
    "PT52H, 2d 4h",
    "PT72H, 3d",
  })
  void durationsAreShortAndRoundedUpToTheSecond(Duration duration, String text) {
    assertThat(DurationText.of(duration)).isEqualTo(text);
  }

  @ParameterizedTest
  @CsvSource("PT-1S")
  void negativeDurationsAreBugs(Duration duration) {
    assertThatThrownBy(() -> DurationText.of(duration)).hasMessageContaining("negative");
  }
}
