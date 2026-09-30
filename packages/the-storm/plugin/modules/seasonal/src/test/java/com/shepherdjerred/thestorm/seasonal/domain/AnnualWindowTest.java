package com.shepherdjerred.thestorm.seasonal.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.MonthDay;
import org.junit.jupiter.api.Test;

final class AnnualWindowTest {

  @Test
  void includesBothStormnightBoundaryDays() {
    var window = new AnnualWindow(MonthDay.of(10, 28), MonthDay.of(10, 31));

    assertThat(window.contains(LocalDate.of(2026, 10, 27))).isFalse();
    assertThat(window.contains(LocalDate.of(2026, 10, 28))).isTrue();
    assertThat(window.contains(LocalDate.of(2026, 10, 31))).isTrue();
    assertThat(window.contains(LocalDate.of(2026, 11, 1))).isFalse();
    assertThat(window.contains(LocalDate.of(2027, 10, 28))).isTrue();
  }

  @Test
  void aWinterWindowCanCrossNewYear() {
    var window = new AnnualWindow(MonthDay.of(12, 20), MonthDay.of(1, 5));

    assertThat(window.contains(LocalDate.of(2026, 12, 20))).isTrue();
    assertThat(window.contains(LocalDate.of(2027, 1, 5))).isTrue();
    assertThat(window.contains(LocalDate.of(2027, 1, 6))).isFalse();
    assertThat(window.contains(LocalDate.of(2026, 12, 19))).isFalse();
  }
}
