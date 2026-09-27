package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.GOVERNOR;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

final class WithinPrimaryRuleTest {

  private final WithinPrimaryRule rule = new WithinPrimaryRule();

  /** Every primary level 1..5 against every secondary level 1..5 being bought. */
  static Stream<Arguments> everyPrimaryAndRequestedLevel() {
    return IntStream.rangeClosed(1, Track.MAX_LEVEL)
        .boxed()
        .flatMap(
            primary ->
                IntStream.rangeClosed(1, Track.MAX_LEVEL)
                    .mapToObj(requested -> Arguments.of(primary, requested)));
  }

  @ParameterizedTest(name = "primary {0}, secondary asks for {1}")
  @MethodSource("everyPrimaryAndRequestedLevel")
  void aSecondaryMayReachButNeverPassThePrimary(int primaryLevel, int requested) {
    var progress =
        requested == 1
            ? owning(MECHANIC, primaryLevel)
            : owning(MECHANIC, primaryLevel, ENGINEER, Math.min(requested - 1, primaryLevel));
    var attempt = new PurchaseAttempt(progress, ENGINEER, requested, NOW, 0);

    var problem = rule.check(attempt);

    if (requested <= primaryLevel) {
      assertThat(problem).isEmpty();
    } else {
      assertThat(problem)
          .contains(new PurchaseProblem.AbovePrimary(ENGINEER, requested, MECHANIC, primaryLevel));
    }
  }

  @ParameterizedTest
  @EnumSource(Track.class)
  void theFirstTrackBoughtIsNeverCapped(Track track) {
    assertThat(rule.check(PurchaseAttempt.next(TrackProgress.empty(), track, NOW, 0))).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 2, 3, 4})
  void thePrimaryItselfIsNeverCapped(int level) {
    var progress = owning(MECHANIC, level, ENGINEER, level);

    assertThat(rule.check(PurchaseAttempt.next(progress, MECHANIC, NOW, 0))).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 2, 3})
  void aThirdTrackIsCappedByThePrimaryNotBySecondaries(int primaryLevel) {
    var progress = owning(MECHANIC, primaryLevel, ENGINEER, 1);

    assertThat(rule.check(new PurchaseAttempt(progress, GOVERNOR, primaryLevel, NOW, 0))).isEmpty();
    assertThat(rule.check(new PurchaseAttempt(progress, GOVERNOR, primaryLevel + 1, NOW, 0)))
        .contains(
            new PurchaseProblem.AbovePrimary(GOVERNOR, primaryLevel + 1, MECHANIC, primaryLevel));
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 6})
  void levelsThatDoNotExistAreLeftToTheLevelRules(int requested) {
    var progress = owning(MECHANIC, 5, ENGINEER, 5);

    assertThat(rule.check(new PurchaseAttempt(progress, ENGINEER, requested, NOW, 0))).isEmpty();
  }
}
