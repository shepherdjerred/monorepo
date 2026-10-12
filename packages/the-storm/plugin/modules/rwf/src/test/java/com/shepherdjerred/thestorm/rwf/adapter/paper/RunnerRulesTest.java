package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.Abilities;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageLog;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSettings;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class RunnerRulesTest {

  private static final MatchSettings SETTINGS =
      new MatchSettings(
          4,
          2,
          60,
          Duration.ofSeconds(90),
          Duration.ofSeconds(15),
          Duration.ofSeconds(15),
          Duration.ofMinutes(1),
          Duration.ofSeconds(20),
          Duration.ofSeconds(10),
          Duration.ofSeconds(5),
          true);

  private static RwfMatch countingDownTo(java.time.Instant startsAt) {
    return new RwfMatch(
        SETTINGS,
        Samples.MATCH,
        Samples.SEED,
        new Phase.Countdown(startsAt, T0, 0, Ballot.NONE),
        Optional.empty(),
        List.of(),
        List.of(),
        List.of(),
        DamageLog.EMPTY,
        Map.of(),
        Abilities.NONE);
  }

  @Test
  void botsWalkInOverHalfOfWhatIsLeftOfTheCountdownAndNeverANegativeSpan() {
    assertThat(RunnerRules.arrivalBudget(countingDownTo(T0.plusSeconds(60)), T0))
        .isEqualTo(Duration.ofSeconds(30));
    // The map loaded just after the countdown ran out, before the tick moved the match on.
    assertThat(RunnerRules.arrivalBudget(countingDownTo(T0), T0.plusMillis(200)))
        .isEqualTo(Duration.ZERO);
  }
}
