package com.shepherdjerred.thestorm.rwf.domain.lobby;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/** Drafted bots trickle in one at a time and all arrive within the share of the countdown. */
final class ArrivalsTest {

  @Test
  void botsArriveOneToEightSecondsApartWhenThereIsRoom() {
    var offsets = Arrivals.offsets(7, 42, Duration.ofMinutes(5));

    assertThat(offsets).hasSize(7).isSorted();
    var previous = Duration.ZERO;
    for (var offset : offsets) {
      assertThat(offset.minus(previous)).isBetween(Arrivals.MIN_GAP, Arrivals.MAX_GAP);
      previous = offset;
    }
  }

  @Test
  void aShortCountdownSqueezesEveryArrivalIntoItsBudget() {
    var budget = Duration.ofMillis(3600);
    var offsets = Arrivals.offsets(7, 42, budget);

    assertThat(offsets).hasSize(7).isSorted();
    assertThat(offsets.getLast()).isLessThanOrEqualTo(budget);
    assertThat(offsets.getFirst()).isPositive();
  }

  @Test
  void theScheduleIsSeeded() {
    assertThat(Arrivals.offsets(5, 1, Duration.ofSeconds(54)))
        .isEqualTo(Arrivals.offsets(5, 1, Duration.ofSeconds(54)))
        .isNotEqualTo(Arrivals.offsets(5, 2, Duration.ofSeconds(54)));
    assertThat(Arrivals.offsets(0, 1, Duration.ofSeconds(54))).isEmpty();
  }
}
