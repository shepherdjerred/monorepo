package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.GOVERNOR;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.DEFAULT_PRICING;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class AffordableRuleTest {

  private final AffordableRule rule = new AffordableRule(DEFAULT_PRICING);

  @Test
  void exactlyThePricePasses() {
    assertThat(rule.check(PurchaseAttempt.next(TrackProgress.empty(), MECHANIC, NOW, 1_000)))
        .isEmpty();
  }

  @Test
  void oneCrystalShortFails() {
    assertThat(rule.check(PurchaseAttempt.next(TrackProgress.empty(), MECHANIC, NOW, 999)))
        .contains(new PurchaseProblem.CannotAfford(1_000, 999));
  }

  @Test
  void theSecondTrackIsPricedAtItsPosition() {
    var progress = owning(MECHANIC, 1);

    assertThat(rule.check(PurchaseAttempt.next(progress, ENGINEER, NOW, 1_499)))
        .contains(new PurchaseProblem.CannotAfford(1_500, 1_499));
    assertThat(rule.check(PurchaseAttempt.next(progress, ENGINEER, NOW, 1_500))).isEmpty();
  }

  @Test
  void theThirdTrackCostsDouble() {
    var progress = owning(MECHANIC, 2, ENGINEER, 1);

    assertThat(rule.check(PurchaseAttempt.next(progress, GOVERNOR, NOW, 0)))
        .contains(new PurchaseProblem.CannotAfford(2_000, 0));
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 6})
  void levelsThatDoNotExistHaveNoPrice(int level) {
    assertThat(rule.check(new PurchaseAttempt(owning(MECHANIC, 5), MECHANIC, level, NOW, 0)))
        .isEmpty();
  }
}
