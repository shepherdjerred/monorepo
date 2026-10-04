package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** Levels move only after a sustained run of samples, one step down at a time, never flapping. */
final class GovernorTest {

  private static Governor governor() {
    return new Governor(new Governor.Settings(40, 47, 6, 35, 4, 3, 48, 2));
  }

  private static void feed(Governor governor, double mspt, double bot, int times) {
    for (var i = 0; i < times; i++) {
      governor.observe(new Governor.Sample(mspt, bot));
    }
  }

  @Test
  void aShortSpikeDoesNotMoveTheLevel() {
    var governor = governor();
    feed(governor, 45, 1, 2);
    feed(governor, 20, 1, 1);
    feed(governor, 45, 1, 2);

    assertThat(governor.level()).isZero();
    assertThat(governor.thinkPeriodMultiplier()).isEqualTo(1);
    assertThat(governor.thinsIsolatedReflex()).isFalse();
    assertThat(governor.draftReduction()).isZero();
  }

  @Test
  void sustainedPressureRaisesTheLevelAndBotSectionsCountToo() {
    var governor = governor();
    feed(governor, 45, 1, 3);
    assertThat(governor.level()).isEqualTo(1);
    assertThat(governor.thinkPeriodMultiplier()).isEqualTo(2);
    assertThat(governor.thinsIsolatedReflex()).isTrue();

    var bySections = governor();
    feed(bySections, 20, 7, 3);
    assertThat(bySections.level()).isEqualTo(1);
  }

  @Test
  void heavyPressureGoesStraightToLevelTwoAndDraftsFewerNextMatch() {
    var governor = governor();
    feed(governor, 50, 1, 3);

    assertThat(governor.level()).isEqualTo(2);
    assertThat(governor.draftReduction()).isEqualTo(2);
  }

  @Test
  void recoveryNeedsCalmBelowTheRecoverThresholdsAndStepsDownOneLevelAtATime() {
    var governor = governor();
    feed(governor, 50, 1, 3);
    feed(governor, 38, 1, 10);
    assertThat(governor.level()).as("between thresholds holds").isEqualTo(2);

    feed(governor, 20, 1, 2);
    assertThat(governor.level()).isEqualTo(2);
    feed(governor, 20, 1, 1);
    assertThat(governor.level()).isEqualTo(1);
    feed(governor, 20, 5, 10);
    assertThat(governor.level()).as("bot sections still above recovery").isEqualTo(1);
    feed(governor, 20, 1, 3);
    assertThat(governor.level()).isZero();
  }

  @Test
  void settingsMustBeOrdered() {
    assertThatThrownBy(() -> new Governor.Settings(40, 40, 6, 35, 4, 3, 48, 2))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Governor.Settings(40, 47, 6, 41, 4, 3, 48, 2))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Governor.Settings(40, 47, 6, 35, 7, 3, 48, 2))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Governor.Sample(-1, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
