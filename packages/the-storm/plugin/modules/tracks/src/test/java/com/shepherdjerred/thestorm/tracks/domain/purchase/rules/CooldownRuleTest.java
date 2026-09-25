package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.boughtAt;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import java.time.Duration;
import org.junit.jupiter.api.Test;

final class CooldownRuleTest {

  private static final Duration DAY = Duration.ofHours(24);
  private final CooldownRule rule = new CooldownRule(DAY);

  private PurchaseAttempt attemptAt(java.time.Instant now) {
    return PurchaseAttempt.next(boughtAt(owning(MECHANIC, 1), NOW), MECHANIC, now, 0);
  }

  @Test
  void aPlayerWhoNeverBoughtPasses() {
    assertThat(rule.check(PurchaseAttempt.next(owning(MECHANIC, 1), MECHANIC, NOW, 0))).isEmpty();
  }

  @Test
  void rightAfterAPurchaseFails() {
    assertThat(rule.check(attemptAt(NOW))).contains(new PurchaseProblem.CoolingDown(NOW.plus(DAY)));
  }

  @Test
  void oneNanosecondBeforeTheEndFails() {
    assertThat(rule.check(attemptAt(NOW.plus(DAY).minusNanos(1))))
        .contains(new PurchaseProblem.CoolingDown(NOW.plus(DAY)));
  }

  @Test
  void theCooldownEndsExactlyOnTime() {
    assertThat(rule.check(attemptAt(NOW.plus(DAY)))).isEmpty();
  }

  @Test
  void laterPasses() {
    assertThat(rule.check(attemptAt(NOW.plus(DAY).plusSeconds(1)))).isEmpty();
  }

  @Test
  void theCooldownCoversEveryTrack() {
    var progress = boughtAt(owning(MECHANIC, 1), NOW);

    assertThat(rule.check(PurchaseAttempt.next(progress, ENGINEER, NOW.plusSeconds(60), 0)))
        .contains(new PurchaseProblem.CoolingDown(NOW.plus(DAY)));
  }

  @Test
  void aZeroCooldownIsDisabled() {
    var disabled = new CooldownRule(Duration.ZERO);

    assertThat(disabled.check(attemptAt(NOW))).isEmpty();
  }

  @Test
  void aClockBehindTheLastPurchaseStillWaits() {
    assertThat(rule.check(attemptAt(NOW.minusSeconds(5))))
        .contains(new PurchaseProblem.CoolingDown(NOW.plus(DAY)));
  }

  @Test
  void aNegativeCooldownIsRejected() {
    assertThatThrownBy(() -> new CooldownRule(Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
