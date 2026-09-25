package com.shepherdjerred.thestorm.npcs.domain.schedule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Schedule.Slot;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class ScheduleTest {

  private static final Activity WORK = new Activity.Stay("shop");
  private static final Activity STROLL = new Activity.Wander("market", 5);
  private static final Activity SLEEP = new Activity.Sleep("bed");

  private static TimeOfDay at(String clock) {
    return TimeOfDay.parse(clock)
        .fold(
            time -> time,
            problem -> {
              throw new AssertionError(problem);
            });
  }

  private static Slot slot(String from, String to, Activity activity) {
    return new Slot(new TimeRange(at(from), at(to)), activity);
  }

  private static final List<Slot> DAY =
      List.of(
          slot("06:00", "18:00", WORK),
          slot("18:00", "22:00", STROLL),
          slot("22:00", "06:00", SLEEP));

  @Test
  void resolvesTheActivityAtEveryBoundary() {
    var schedule = new Schedule("day", DAY, Optional.empty());
    assertThat(schedule.activityAt(at("06:00"))).isEqualTo(WORK);
    assertThat(schedule.activityAt(at("17:59"))).isEqualTo(WORK);
    assertThat(schedule.activityAt(at("18:00"))).isEqualTo(STROLL);
    assertThat(schedule.activityAt(at("21:59"))).isEqualTo(STROLL);
    assertThat(schedule.activityAt(at("22:00"))).isEqualTo(SLEEP);
    assertThat(schedule.activityAt(at("23:59"))).isEqualTo(SLEEP);
    assertThat(schedule.activityAt(at("00:00"))).isEqualTo(SLEEP);
    assertThat(schedule.activityAt(at("05:59"))).isEqualTo(SLEEP);
  }

  @Test
  void resolvesFromWorldTime() {
    var schedule = new Schedule("day", DAY, Optional.empty());
    // World time 0 is 06:00; 16000 is 22:00; 18000 is midnight.
    assertThat(schedule.activityAt(TimeOfDay.fromWorldTicks(0))).isEqualTo(WORK);
    assertThat(schedule.activityAt(TimeOfDay.fromWorldTicks(16_000))).isEqualTo(SLEEP);
    assertThat(schedule.activityAt(TimeOfDay.fromWorldTicks(18_000))).isEqualTo(SLEEP);
    assertThat(schedule.activityAt(TimeOfDay.fromWorldTicks(12_500))).isEqualTo(STROLL);
  }

  @Test
  void oneWholeDaySlotIsValid() {
    var schedule =
        new Schedule("always", List.of(slot("00:00", "00:00", WORK)), Optional.of("inn"));
    assertThat(schedule.activityAt(at("13:37"))).isEqualTo(WORK);
    assertThat(schedule.shelter()).contains("inn");
  }

  @Test
  void slotOrderDoesNotMatter() {
    var shuffled = List.of(DAY.get(2), DAY.get(0), DAY.get(1));
    var schedule = new Schedule("day", shuffled, Optional.empty());
    assertThat(schedule.activityAt(at("03:00"))).isEqualTo(SLEEP);
    assertThat(schedule.sorted()).extracting(Slot::activity).containsExactly(WORK, STROLL, SLEEP);
  }

  @Test
  void reportsGapsIncludingAcrossMidnight() {
    var problems =
        Schedule.problems(List.of(slot("06:00", "18:00", WORK), slot("20:00", "23:00", SLEEP)));
    assertThat(problems)
        .containsExactly(
            "no slot covers 00:00-06:00",
            "no slot covers 18:00-20:00",
            "no slot covers 23:00-00:00");
  }

  @Test
  void reportsOverlaps() {
    var problems =
        Schedule.problems(List.of(slot("06:00", "18:00", WORK), slot("17:00", "06:00", SLEEP)));
    assertThat(problems).containsExactly("slots 06:00-18:00 and 17:00-06:00 overlap at 17:00");
  }

  @Test
  void aWholeDaySlotOverlapsAnything() {
    assertThat(
            Schedule.problems(List.of(slot("00:00", "00:00", WORK), slot("01:00", "02:00", SLEEP))))
        .containsExactly("slots 00:00-00:00 and 01:00-02:00 overlap at 01:00");
  }

  @Test
  void rejectsAnEmptyOrBrokenSchedule() {
    assertThat(Schedule.problems(List.of())).containsExactly("a schedule needs at least one slot");
    var partial = List.of(slot("06:00", "18:00", WORK));
    assertThatThrownBy(() -> new Schedule("partial", partial, Optional.empty()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("no slot covers 18:00-00:00");
  }

  @Test
  void parsesEveryActivity() {
    assertThat(Activity.parse("stay shop")).isEqualTo(Result.ok(new Activity.Stay("shop")));
    assertThat(Activity.parse("  sleep   bed ")).isEqualTo(Result.ok(new Activity.Sleep("bed")));
    assertThat(Activity.parse("wander market 12"))
        .isEqualTo(Result.ok(new Activity.Wander("market", 12)));
    assertThat(Activity.parse("patrol gate market tavern"))
        .isEqualTo(Result.ok(new Activity.Patrol(List.of("gate", "market", "tavern"))));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "dance shop",
        "stay",
        "stay a b",
        "stay Shop",
        "wander market",
        "wander market 0",
        "wander market 33",
        "wander market far",
        "patrol gate",
        "patrol gate BAD",
        "sleep"
      })
  void rejectsMalformedActivities(String line) {
    assertThat(Activity.parse(line).isOk()).isFalse();
  }

  @Test
  void listsPlacesForReferenceChecks() {
    assertThat(new Activity.Patrol(List.of("a", "b")).places()).containsExactly("a", "b");
    assertThat(STROLL.places()).containsExactly("market");
  }
}
