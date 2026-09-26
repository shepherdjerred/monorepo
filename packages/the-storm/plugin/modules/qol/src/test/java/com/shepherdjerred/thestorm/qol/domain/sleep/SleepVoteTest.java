package com.shepherdjerred.thestorm.qol.domain.sleep;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.qol.domain.sleep.SleepVote.Sleeper;
import com.shepherdjerred.thestorm.qol.domain.sleep.SleepVote.Tally;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class SleepVoteTest {

  static final Sleeper ASLEEP = new Sleeper(true, true, false, false);
  static final Sleeper DOZING = new Sleeper(true, false, false, false);
  static final Sleeper AWAKE = new Sleeper(false, false, false, false);
  static final Sleeper AWAY = new Sleeper(false, false, true, false);
  static final Sleeper AWAY_IN_BED = new Sleeper(true, true, true, false);
  static final Sleeper SPECTATOR = new Sleeper(false, false, false, true);

  static final SleepVote HALF = new SleepVote(50);

  @ParameterizedTest
  @CsvSource({
    // percent, counted players, needed
    "50, 0, 0",
    "50, 1, 1",
    "50, 2, 1",
    "50, 3, 2",
    "50, 4, 2",
    "100, 3, 3",
    "1, 3, 1",
    "34, 3, 2",
    "33, 3, 1",
    "67, 3, 3",
    "66, 3, 2",
  })
  void theShareIsRoundedUpAndAtLeastOne(int percent, int counted, int needed) {
    assertThat(new SleepVote(percent).needed(counted)).isEqualTo(needed);
  }

  @Test
  void aLonePlayerSkipsTheNightAlone() {
    assertThat(HALF.tally(List.of(ASLEEP))).isEqualTo(new Tally(1, 1, 1, 1));
    assertThat(HALF.tally(List.of(ASLEEP)).skips()).isTrue();
  }

  @Test
  void oneOfTwoIsEnoughAtHalf() {
    assertThat(HALF.tally(List.of(ASLEEP, AWAKE)).skips()).isTrue();
  }

  @Test
  void twoOfThreeAreNeededAtHalf() {
    assertThat(HALF.tally(List.of(ASLEEP, AWAKE, AWAKE)).skips()).isFalse();
    assertThat(HALF.tally(List.of(ASLEEP, ASLEEP, AWAKE)).skips()).isTrue();
  }

  @Test
  void awayPlayersDoNotCountUnlessInBed() {
    var tally = HALF.tally(List.of(ASLEEP, AWAY, AWAY));
    assertThat(tally).isEqualTo(new Tally(1, 1, 1, 1));
    assertThat(tally.skips()).isTrue();

    var awayInBed = HALF.tally(List.of(AWAY_IN_BED, AWAKE, AWAKE));
    assertThat(awayInBed).isEqualTo(new Tally(3, 1, 1, 2));
    assertThat(awayInBed.skips()).isFalse();
  }

  @Test
  void spectatorsAndIgnoredPlayersNeverCount() {
    assertThat(HALF.tally(List.of(ASLEEP, SPECTATOR, SPECTATOR))).isEqualTo(new Tally(1, 1, 1, 1));
  }

  @Test
  void theNightOnlyPassesOnceEnoughAreFastAsleep() {
    var dozing = HALF.tally(List.of(DOZING, AWAKE));
    assertThat(dozing).isEqualTo(new Tally(2, 1, 0, 1));
    assertThat(dozing.skips()).isFalse();
  }

  @Test
  void nobodyPresentNeverSkips() {
    assertThat(HALF.tally(List.of()).skips()).isFalse();
    assertThat(HALF.tally(List.of(AWAY, SPECTATOR)).skips()).isFalse();
  }

  @ParameterizedTest
  @CsvSource({"13000, 24000", "23999, 24000", "0, 24000", "24000, 48000", "250000, 264000"})
  void theNightSkipsToTheNextSunrise(long fullTime, long morning) {
    assertThat(SleepVote.nextMorning(fullTime)).isEqualTo(morning);
  }

  @Test
  void thePercentMustBeAPercent() {
    assertThatThrownBy(() -> new SleepVote(0)).hasMessageContaining("1-100");
    assertThatThrownBy(() -> new SleepVote(101)).hasMessageContaining("1-100");
  }
}
