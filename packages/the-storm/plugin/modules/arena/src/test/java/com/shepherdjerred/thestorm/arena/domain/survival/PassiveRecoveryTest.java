package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import org.junit.jupiter.api.Test;

final class PassiveRecoveryTest {
  @Test
  void waitsEightSecondsAfterDamageThenHealsHalfAHeartEveryFiveSeconds() {
    var recovery = new PassiveRecovery();
    recovery.hurt(ALICE, T0);
    assertThat(recovery.recover(ALICE, T0.plusSeconds(7), 2, 20)).isEqualTo(2);
    assertThat(recovery.recover(ALICE, T0.plusSeconds(8), 2, 20)).isEqualTo(3);
    assertThat(recovery.recover(ALICE, T0.plusSeconds(12), 3, 20)).isEqualTo(3);
    assertThat(recovery.recover(ALICE, T0.plusSeconds(13), 3, 20)).isEqualTo(4);
    assertThat(recovery.recover(ALICE, T0.plusSeconds(60), 4, 20)).isEqualTo(5);
  }

  @Test
  void anotherHitRestartsTheDelayWithoutBlockingTeammates() {
    var recovery = new PassiveRecovery();
    recovery.hurt(ALICE, T0);
    recovery.hurt(ALICE, T0.plusSeconds(7));
    assertThat(recovery.recover(ALICE, T0.plusSeconds(14), 2, 20)).isEqualTo(2);
    assertThat(recovery.recover(BOB, T0.plusSeconds(14), 2, 20)).isEqualTo(3);
    assertThat(recovery.recover(ALICE, T0.plusSeconds(15), 2, 20)).isEqualTo(3);
  }

  @Test
  void stopsAtOneThirdOfCurrentMaximumWithoutReducingOtherHealing() {
    var recovery = new PassiveRecovery();
    assertThat(recovery.recover(ALICE, T0, 6, 20)).isEqualTo(20.0 / 3);
    assertThat(recovery.recover(ALICE, T0.plusSeconds(10), 20.0 / 3, 20)).isEqualTo(20.0 / 3);
    assertThat(recovery.recover(ALICE, T0.plusSeconds(20), 12, 20)).isEqualTo(12);
    assertThat(recovery.recover(BOB, T0, 9, 28)).isEqualTo(28.0 / 3);
    assertThat(recovery.recover(BOB, T0.plusSeconds(10), 0, 28)).isZero();
  }

  @Test
  void leavingAndEndingARunDiscardThePreviousCooldowns() {
    var recovery = new PassiveRecovery();
    recovery.hurt(ALICE, T0);
    recovery.remove(ALICE);
    assertThat(recovery.recover(ALICE, T0, 2, 20)).isEqualTo(3);
    recovery.hurt(BOB, T0);
    recovery.reset();
    assertThat(recovery.recover(BOB, T0, 2, 20)).isEqualTo(3);
  }

  @Test
  void invalidHealthIsAnInternalContractFailure() {
    var recovery = new PassiveRecovery();
    assertThatIllegalArgumentException()
        .isThrownBy(() -> recovery.recover(ALICE, T0, Double.NaN, 20));
    assertThatIllegalArgumentException().isThrownBy(() -> recovery.recover(ALICE, T0, 2, 0));
  }
}
