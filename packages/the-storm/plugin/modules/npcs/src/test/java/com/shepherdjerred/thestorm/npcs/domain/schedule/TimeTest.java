package com.shepherdjerred.thestorm.npcs.domain.schedule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

final class TimeTest {

  private static TimeOfDay at(String clock) {
    return TimeOfDay.parse(clock)
        .fold(
            time -> time,
            problem -> {
              throw new AssertionError(problem);
            });
  }

  private static TimeRange range(String from, String to) {
    return new TimeRange(at(from), at(to));
  }

  @ParameterizedTest(name = "{0} is minute {1}")
  @CsvSource({"00:00, 0", "06:00, 360", "12:30, 750", "23:59, 1439"})
  void parsesClockTimes(String clock, int minute) {
    assertThat(TimeOfDay.parse(clock)).isEqualTo(Result.ok(new TimeOfDay(minute)));
    assertThat(new TimeOfDay(minute)).hasToString(clock);
  }

  @ParameterizedTest
  @ValueSource(strings = {"24:00", "6:00", "06:60", "0600", "06:00 ", "noon", ""})
  void rejectsOtherTimes(String clock) {
    assertThat(TimeOfDay.parse(clock).isOk()).isFalse();
  }

  @ParameterizedTest(name = "world time {0} is {1}")
  @CsvSource({
    "0, 06:00",
    "1000, 07:00",
    "6000, 12:00",
    "12000, 18:00",
    "18000, 00:00",
    "23999, 05:59",
    "24000, 06:00",
    "48500, 06:30",
    "17999, 23:59"
  })
  void convertsWorldTicksStartingAtSunrise(long ticks, String clock) {
    assertThat(TimeOfDay.fromWorldTicks(ticks)).isEqualTo(at(clock));
  }

  @Test
  void rejectsNegativeWorldTime() {
    assertThatThrownBy(() -> TimeOfDay.fromWorldTicks(-1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TimeOfDay(1440)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aDaytimeRangeIsHalfOpen() {
    var work = range("09:00", "17:00");
    assertThat(work.contains(at("08:59"))).isFalse();
    assertThat(work.contains(at("09:00"))).isTrue();
    assertThat(work.contains(at("16:59"))).isTrue();
    assertThat(work.contains(at("17:00"))).isFalse();
    assertThat(work.minutes()).isEqualTo(8 * 60);
  }

  @Test
  void aNightRangeWrapsPastMidnight() {
    var night = range("22:00", "06:00");
    assertThat(night.contains(at("21:59"))).isFalse();
    assertThat(night.contains(at("22:00"))).isTrue();
    assertThat(night.contains(at("23:59"))).isTrue();
    assertThat(night.contains(at("00:00"))).isTrue();
    assertThat(night.contains(at("05:59"))).isTrue();
    assertThat(night.contains(at("06:00"))).isFalse();
    assertThat(night.contains(at("12:00"))).isFalse();
    assertThat(night.minutes()).isEqualTo(8 * 60);
  }

  @Test
  void equalEndsAreTheWholeDay() {
    var allDay = range("06:00", "06:00");
    assertThat(allDay.contains(at("05:59"))).isTrue();
    assertThat(allDay.contains(at("06:00"))).isTrue();
    assertThat(allDay.minutes()).isEqualTo(TimeOfDay.DAY);
  }

  @Test
  void aRangeEndingAtMidnight() {
    var evening = range("18:00", "00:00");
    assertThat(evening.contains(at("23:59"))).isTrue();
    assertThat(evening.contains(at("00:00"))).isFalse();
    assertThat(evening.minutes()).isEqualTo(6 * 60);
  }
}
