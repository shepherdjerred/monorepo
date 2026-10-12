package com.shepherdjerred.thestorm.rwf.domain.poison;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock.Notice;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock.Stage;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

final class PoisonClockTest {

  /**
   * Ticks once a second from {@code from} to {@code to} inclusive, returning each second's notices.
   */
  private static List<List<Notice>> run(PoisonClock[] clock, int from, int to) {
    var all = new ArrayList<List<Notice>>();
    for (var second = from; second <= to; second++) {
      var step = clock[0].tick(T0.plusSeconds(second));
      clock[0] = step.clock();
      all.add(step.notices());
    }
    return all;
  }

  @Test
  void withNoDeathsTheTimerHastensAndWarnsAtTwoHundredAndEighteenSeconds() {
    var clock = new PoisonClock[] {PoisonClock.start(T0)};

    var notices = run(clock, 1, 217);
    assertThat(notices).allMatch(List::isEmpty);
    assertThat(clock[0].deathTimer()).isEqualTo(Duration.ofSeconds(600 - 3 * 127));

    var warning = clock[0].tick(T0.plusSeconds(218));

    assertThat(warning.notices()).containsExactly(Notice.WARNING);
    assertThat(warning.clock().stage()).isEqualTo(Stage.WARNED);
    assertThat(warning.clock().deathTimer()).isEqualTo(Duration.ofSeconds(218));
  }

  @Test
  void aDeathEveryMinuteKeepsTheFullTenMinutes() {
    var clock = PoisonClock.start(T0);
    for (var second = 1; second < 600; second++) {
      if (second % 60 == 0) {
        clock = clock.deathAt(T0.plusSeconds(second));
      }
      var step = clock.tick(T0.plusSeconds(second));
      assertThat(step.notices()).isEmpty();
      clock = step.clock();
    }
    assertThat(clock.deathTimer()).isEqualTo(PoisonClock.INITIAL);

    assertThat(clock.tick(T0.plusSeconds(600)).notices()).isEmpty();
    assertThat(clock.tick(T0.plusSeconds(601)).notices()).containsExactly(Notice.WARNING);
  }

  @Test
  void aMinuteAfterTheWarningThePoisonBeginsAndThenHurtsEverySecond() {
    var clock = new PoisonClock[] {PoisonClock.start(T0)};
    run(clock, 1, 218);

    var quiet = run(clock, 219, 278);
    assertThat(quiet).allMatch(List::isEmpty);
    assertThat(clock[0].endGame(T0.plusSeconds(278))).isFalse();
    assertThat(clock[0].untilPoison(T0.plusSeconds(278))).isEqualTo(Duration.ofSeconds(0));

    var begun = run(clock, 279, 281);

    assertThat(begun.get(0)).containsExactly(Notice.BEGUN, Notice.DAMAGE);
    assertThat(begun.get(1)).containsExactly(Notice.DAMAGE);
    assertThat(begun.get(2)).containsExactly(Notice.DAMAGE);
    assertThat(clock[0].stage()).isEqualTo(Stage.DEADLY);
  }

  @Test
  void untilPoisonCountsDownToTheFirstDamage() {
    var clock = PoisonClock.start(T0);

    assertThat(clock.untilPoison(T0)).isEqualTo(Duration.ofMinutes(11));
    assertThat(clock.untilPoison(T0.plusSeconds(60))).isEqualTo(Duration.ofMinutes(10));
  }
}
