package com.shepherdjerred.thestorm.mobs.domain.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class BeginnerLuckTest {
  private final BeginnerLuck luck =
      new BeginnerLuck(Duration.ofHours(6), Duration.ofHours(12), 0.1, 1, 64);

  @ParameterizedTest
  @CsvSource({"0, 0.1, 1", "3, 0.1, 1", "6, 0.1, 1", "9, 0.55, 25", "12, 1, 50", "24, 1, 50"})
  void calmPeriodAndGradualRampHaveNoExpiryCliff(long hours, double multiplier, int level) {
    var ticks = hours * 3600 * 1000;
    assertThat(luck.damageMultiplier(ticks)).isCloseTo(multiplier, within(0.000001));
    assertThat(luck.effectiveLevel(50, ticks)).isEqualTo(level);
  }

  @Test
  void progressionIsMonotonicIncludingExactBoundaries() {
    var previous = 0.0;
    for (long ticks = 0; ticks <= 12 * 3600 * 1000; ticks += 1000) {
      var progress = luck.progress(ticks);
      assertThat(progress).isBetween(previous, 1.0);
      previous = progress;
    }
    assertThat(luck.progress(6 * 3600 * 1000)).isZero();
    assertThat(luck.progress(12 * 3600 * 1000 - 1)).isLessThan(1);
    assertThat(luck.progress(12 * 3600 * 1000)).isOne();
  }

  @Test
  void shortConfiguredWindowsKeepMillisecondPrecision() {
    var shortWindow = new BeginnerLuck(Duration.ofMillis(100), Duration.ofMillis(500), 0.1, 1, 64);
    assertThat(shortWindow.progress(300)).isEqualTo(0.5);
    assertThatThrownBy(() -> new BeginnerLuck(Duration.ZERO, Duration.ofNanos(1), 0.1, 1, 64))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void invalidConfigurationAndCorruptPlaytimeAreRejected() {
    assertThatThrownBy(
            () -> new BeginnerLuck(Duration.ofHours(-1), Duration.ofHours(12), 0.1, 1, 64))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BeginnerLuck(Duration.ofHours(6), Duration.ofHours(6), 0.1, 1, 64))
        .isInstanceOf(IllegalArgumentException.class);
    for (var multiplier : new double[] {-0.1, 1.1, Double.NaN, Double.POSITIVE_INFINITY}) {
      assertThatThrownBy(
              () -> new BeginnerLuck(Duration.ofHours(6), Duration.ofHours(12), multiplier, 1, 64))
          .isInstanceOf(IllegalArgumentException.class);
    }
    assertThatThrownBy(() -> luck.progress(-1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> luck.effectiveLevel(0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
