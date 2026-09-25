package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class NextLevelOnlyRuleTest {

  private final NextLevelOnlyRule rule = new NextLevelOnlyRule();

  private static TrackProgress at(int level) {
    return level == 0 ? TrackProgress.empty() : owning(MECHANIC, level);
  }

  @ParameterizedTest(name = "{0} -> {1}")
  @CsvSource({"0, 1", "1, 2", "2, 3", "3, 4", "4, 5"})
  void theNextLevelPasses(int current, int requested) {
    assertThat(rule.check(new PurchaseAttempt(at(current), MECHANIC, requested, NOW, 0))).isEmpty();
  }

  @ParameterizedTest(name = "{0} -> {1}")
  @CsvSource({
    // Skipping ahead.
    "0, 2",
    "0, 5",
    "1, 3",
    "2, 5",
    "3, 5",
    // Buying a level already owned, or going down.
    "1, 1",
    "3, 2",
    "4, 1",
    "2, 0",
    // Levels that do not exist.
    "0, 0",
    "0, -1",
    "4, 6",
  })
  void anyOtherLevelFails(int current, int requested) {
    assertThat(rule.check(new PurchaseAttempt(at(current), MECHANIC, requested, NOW, 0)))
        .contains(new PurchaseProblem.NotNextLevel(MECHANIC, current, requested));
  }

  @ParameterizedTest
  @CsvSource({"5, 6", "5, 5", "5, 1"})
  void aMaxedTrackIsLeftToTheMaxedRule(int current, int requested) {
    assertThat(rule.check(new PurchaseAttempt(at(current), MECHANIC, requested, NOW, 0))).isEmpty();
  }
}
