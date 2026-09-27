package com.shepherdjerred.thestorm.chat.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

final class MuteAndDurationsTest {

  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");

  @Test
  void muteEndsExactlyAtItsEnd() {
    var mute = Mute.starting(NOW, Duration.ofMinutes(10), "spam", "Mod");

    assertThat(mute.activeAt(NOW)).isTrue();
    assertThat(mute.activeAt(NOW.plusSeconds(599))).isTrue();
    assertThat(mute.activeAt(NOW.plusSeconds(600))).isFalse();
    assertThat(mute.remainingAt(NOW.plusSeconds(60))).isEqualTo(Duration.ofMinutes(9));
    assertThat(mute.remainingAt(NOW.plusSeconds(900))).isEqualTo(Duration.ZERO);
  }

  @Test
  void muteNeedsAPositiveLengthAndAReason() {
    assertThatThrownBy(() -> Mute.starting(NOW, Duration.ZERO, "spam", "Mod"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Mute.starting(NOW, Duration.ofMinutes(1), " ", "Mod"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Mute(NOW, "spam", ""))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @CsvSource({
    "30s,PT30S",
    "10m,PT10M",
    "2h,PT2H",
    "1d12h,PT36H",
    "1h30m15s,PT1H30M15S",
    "1D,PT24H"
  })
  void parsesDurations(String input, String expected) {
    assertThat(Durations.parse(input)).isEqualTo(Result.ok(Duration.parse(expected)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "10", "m", "10x", "-5m", "0m", "1m 2s", "9999999d", "perm"})
  void rejectsBadDurations(String input) {
    assertThat(Durations.parse(input).isOk()).isFalse();
  }

  @Test
  void formatsDurations() {
    assertThat(Durations.format(Duration.ofSeconds(90))).isEqualTo("1m 30s");
    assertThat(Durations.format(Duration.ofHours(26))).isEqualTo("1d 2h");
    assertThat(Durations.format(Duration.ofMillis(200))).isEqualTo("1s");
    assertThat(Durations.format(Duration.ofMillis(1200))).isEqualTo("2s");
    assertThat(Durations.format(Duration.ZERO)).isEqualTo("0s");
  }
}
