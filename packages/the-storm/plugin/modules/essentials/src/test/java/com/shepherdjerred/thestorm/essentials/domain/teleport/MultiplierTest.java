package com.shepherdjerred.thestorm.essentials.domain.teleport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class MultiplierTest {

  @Test
  void neverBelowOne() {
    assertThatThrownBy(() -> new Multiplier(99)).isInstanceOf(IllegalArgumentException.class);
    assertThat(new Multiplier(100)).isEqualTo(Multiplier.ONE);
  }

  @ParameterizedTest
  @CsvSource({"1.0, 100", "1.5, 150", "2.345, 235", "4, 400", "1.004, 100", "1.005, 101"})
  void convertsDecimalsToHundredths(double factor, long hundredths) {
    assertThat(Multiplier.of(factor).hundredths()).isEqualTo(hundredths);
  }

  @Test
  void rejectsNegativeOrNonFiniteSteps() {
    assertThatThrownBy(() -> Multiplier.hundredthsOf(-0.1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Multiplier.hundredthsOf(Double.NaN))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Multiplier.hundredthsOf(Double.POSITIVE_INFINITY))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void growsUpToTheCap() {
    var cap = Multiplier.of(2);
    assertThat(Multiplier.ONE.grow(50, cap)).isEqualTo(Multiplier.of(1.5));
    assertThat(Multiplier.of(1.5).grow(50, cap)).isEqualTo(cap);
    assertThat(Multiplier.of(1.75).grow(50, cap)).isEqualTo(cap);
    assertThat(cap.grow(50, cap)).isEqualTo(cap);
  }

  @Test
  void shrinksDownToOne() {
    assertThat(Multiplier.of(2).shrink(50)).isEqualTo(Multiplier.of(1.5));
    assertThat(Multiplier.of(1.25).shrink(50)).isEqualTo(Multiplier.ONE);
    assertThat(Multiplier.ONE.shrink(1_000)).isEqualTo(Multiplier.ONE);
  }

  @ParameterizedTest
  @CsvSource({"100, 25, 25", "150, 25, 38", "150, 10, 15", "101, 1, 2", "400, 0, 0"})
  void roundsCostsUp(long hundredths, long base, long expected) {
    assertThat(new Multiplier(hundredths).applyTo(base)).isEqualTo(expected);
  }

  @Test
  void scalesDurationsToTheMillisecond() {
    assertThat(Multiplier.of(1.5).applyTo(Duration.ofSeconds(10)))
        .isEqualTo(Duration.ofSeconds(15));
    assertThat(Multiplier.of(1.33).applyTo(Duration.ofMillis(1))).isEqualTo(Duration.ofMillis(1));
  }

  @Test
  void printsLikeAFactor() {
    assertThat(Multiplier.ONE).hasToString("x1");
    assertThat(Multiplier.of(1.5)).hasToString("x1.5");
    assertThat(Multiplier.of(2.25)).hasToString("x2.25");
  }

  @Test
  void ordersByValue() {
    assertThat(Multiplier.ONE).isLessThan(Multiplier.of(1.01));
  }
}
