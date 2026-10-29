package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class SpeechControlTest {
  @Test
  void casualLinesShareOneGlobalBudgetAndEachBotWaitsFortyFiveSeconds() {
    var control = new SpeechControl();
    var first = new UUID(0, 1);
    var second = new UUID(0, 2);
    assertThat(control.deliver(first, Optional.empty(), "hello", Instant.EPOCH)).isTrue();
    assertThat(control.deliver(second, Optional.empty(), "hey", Instant.EPOCH.plusSeconds(19)))
        .isFalse();
    assertThat(control.deliver(second, Optional.empty(), "hey", Instant.EPOCH.plusSeconds(20)))
        .isTrue();
    assertThat(control.deliver(first, Optional.empty(), "again", Instant.EPOCH.plusSeconds(44)))
        .isFalse();
    assertThat(control.deliver(first, Optional.empty(), "again", Instant.EPOCH.plusSeconds(45)))
        .isTrue();
  }

  @Test
  void tacticalBudgetsArePerTeamWithPersonalCooldownAndDeduplication() {
    var control = new SpeechControl();
    var red = Optional.of("red");
    var one = new UUID(0, 1);
    var two = new UUID(0, 2);
    var three = new UUID(0, 3);
    assertThat(control.deliver(one, red, "near bomb", Instant.EPOCH)).isTrue();
    assertThat(control.deliver(two, red, "near bomb", Instant.EPOCH.plusSeconds(1))).isFalse();
    assertThat(control.deliver(two, red, "left lane", Instant.EPOCH.plusSeconds(1))).isTrue();
    assertThat(control.deliver(three, red, "right lane", Instant.EPOCH.plusSeconds(14))).isFalse();
    assertThat(control.deliver(one, red, "again", Instant.EPOCH.plusSeconds(14))).isFalse();
    assertThat(control.deliver(one, red, "again", Instant.EPOCH.plusSeconds(15))).isTrue();
    assertThat(
            control.deliver(three, Optional.of("blue"), "near bomb", Instant.EPOCH.plusSeconds(1)))
        .isTrue();
  }

  @Test
  void typingHasARealReactionAndLengthDependentBoundedDuration() {
    var random = new SplittableRandom(3);
    for (var draw = 0; draw < 100; draw++) {
      assertThat(SpeechControl.reaction(random).toMillis()).isBetween(400L, 900L);
      assertThat(SpeechControl.typing("hi", random).toMillis()).isEqualTo(800L);
      assertThat(SpeechControl.typing("x".repeat(100), random).toMillis()).isEqualTo(4000L);
      assertThat(SpeechControl.typing("enemy near our bomb", random).toMillis())
          .isBetween(2000L, 4000L);
    }
  }

  private static SpeechControl.Line urgent(UUID speaker, String text) {
    return new SpeechControl.Line(speaker, Optional.of("red"), text, true);
  }

  @Test
  void urgentTeamCallsGoAheadOfSightingsWithinTheirOwnLargerBudget() {
    var control = new SpeechControl();
    var red = Optional.of("red");
    var one = new UUID(0, 1);
    var two = new UUID(0, 2);
    var three = new UUID(0, 3);
    assertThat(control.deliver(one, red, "enemy mid", Instant.EPOCH)).isTrue();
    assertThat(control.deliver(two, red, "enemy west", Instant.EPOCH.plusSeconds(1))).isTrue();
    // The sightings' budget is spent; an objective call still goes out, even from a bot that
    // just spoke, once its short wait has passed.
    assertThat(control.deliver(three, red, "enemy east", Instant.EPOCH.plusSeconds(2))).isFalse();
    assertThat(control.deliver(urgent(three, "planting"), Instant.EPOCH.plusSeconds(2))).isTrue();
    assertThat(control.deliver(urgent(one, "retake"), Instant.EPOCH.plusSeconds(3))).isFalse();
    assertThat(control.deliver(urgent(one, "retake"), Instant.EPOCH.plusSeconds(4))).isTrue();
    assertThat(control.deliver(urgent(two, "defusing"), Instant.EPOCH.plusSeconds(6)))
        .as("four team lines in fifteen seconds is the most")
        .isFalse();
    assertThat(control.remaining(red, Instant.EPOCH.plusSeconds(15), true)).isEqualTo(1);
  }
}
