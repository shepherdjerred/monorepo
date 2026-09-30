package com.shepherdjerred.thestorm.seasonal.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class DailyDoorsTest {

  private static final LocalDate DAY = LocalDate.of(2026, 10, 28);

  @Test
  void sameDoorCanBeClaimedOncePerDay() {
    var initial = new DailyDoors(DAY, Set.of());
    var first = initial.claim("1,64,2", 11);

    assertThat(first.status()).isEqualTo(DailyDoors.Status.GRANTED);
    assertThat(first.state().claim("1,64,2", 11).status())
        .isEqualTo(DailyDoors.Status.ALREADY_VISITED);
    assertThat(DailyDoors.parse(first.state().serialize(), DAY).visited())
        .containsExactly("1,64,2");
    assertThat(DailyDoors.parse(first.state().serialize(), DAY.plusDays(1)).visited()).isEmpty();
  }

  @Test
  void dailyLimitAppliesAcrossDifferentDoors() {
    var state = new DailyDoors(DAY, Set.of("1,64,2"));

    assertThat(state.claim("2,64,2", 1).status()).isEqualTo(DailyDoors.Status.DAILY_LIMIT);
  }

  @Test
  void corruptSavedStateFailsLoudly() {
    assertThatThrownBy(() -> DailyDoors.parse("2026-10-28|wrong", DAY))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
