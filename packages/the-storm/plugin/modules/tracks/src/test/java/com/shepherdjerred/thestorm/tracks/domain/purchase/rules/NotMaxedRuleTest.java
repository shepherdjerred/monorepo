package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class NotMaxedRuleTest {

  private final NotMaxedRule rule = new NotMaxedRule();

  @ParameterizedTest
  @ValueSource(ints = {1, 2, 3, 4})
  void aTrackBelowTheTopPasses(int level) {
    var progress = owning(MECHANIC, level);

    assertThat(rule.check(PurchaseAttempt.next(progress, MECHANIC, NOW, 0))).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 1, 2, 3, 4, 5, 6})
  void anyRequestOnAMaxedTrackFails(int requested) {
    var progress = owning(MECHANIC, 5);

    assertThat(rule.check(new PurchaseAttempt(progress, MECHANIC, requested, NOW, 0)))
        .contains(new PurchaseProblem.AlreadyMaxed(MECHANIC));
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 1, 2, 3, 4, 5})
  void otherTracksAreNotAffected(int level) {
    var progress = level == 0 ? owning(MECHANIC, 5) : owning(MECHANIC, 5, ENGINEER, level);

    assertThat(rule.check(PurchaseAttempt.next(progress, ENGINEER, NOW, 0)).isPresent())
        .isEqualTo(level == 5);
  }
}
