package com.shepherdjerred.thestorm.npcs.domain.content;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.domain.brain.NpcBrain;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentCompiler.Located;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.ScheduleEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.SlotEntry;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Activity;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Schedule;
import com.shepherdjerred.thestorm.npcs.domain.schedule.TimeOfDay;
import com.shepherdjerred.thestorm.npcs.domain.schedule.TimeRange;
import java.util.ArrayList;
import java.util.Optional;
import java.util.Set;

/** Validates one schedule entry. */
final class ScheduleCompiler {

  private final Problems problems;
  private final Set<String> places;
  private final Located<ScheduleEntry> located;
  private boolean failed;

  ScheduleCompiler(Problems problems, Set<String> places, Located<ScheduleEntry> located) {
    this.problems = problems;
    this.places = places;
    this.located = located;
  }

  Optional<Schedule> compile() {
    var entry = located.entry();
    Optional<String> shelter = Optional.empty();
    if (!Ids.NONE.equals(entry.shelter())) {
      requirePlace(entry.shelter(), "shelter");
      shelter = Optional.of(entry.shelter());
    }
    var slots = new ArrayList<Schedule.Slot>();
    for (var index = 0; index < entry.slots().size(); index++) {
      slot(entry.slots().get(index), "slots[" + index + "]").ifPresent(slots::add);
    }
    if (failed) {
      return Optional.empty();
    }
    var coverage = Schedule.problems(slots);
    if (!coverage.isEmpty()) {
      coverage.forEach(problem -> problems.add(located, "slots", problem));
      return Optional.empty();
    }
    return Optional.of(new Schedule(located.id(), slots, shelter));
  }

  private Optional<Schedule.Slot> slot(SlotEntry entry, String path) {
    var from = time(entry.from(), path + ".from");
    var to = time(entry.to(), path + ".to");
    var activity =
        switch (Activity.parse(entry.activity())) {
          case Result.Ok<Activity, String>(var value) -> Optional.of(value);
          case Result.Err<Activity, String>(var problem) -> {
            fail(path + ".activity", problem);
            yield Optional.<Activity>empty();
          }
        };
    activity.ifPresent(
        parsed -> parsed.places().forEach(place -> requirePlace(place, path + ".activity")));
    if (from.isEmpty() || to.isEmpty() || activity.isEmpty()) {
      return Optional.empty();
    }
    return Optional.of(new Schedule.Slot(new TimeRange(from.get(), to.get()), activity.get()));
  }

  private Optional<TimeOfDay> time(String text, String path) {
    return switch (TimeOfDay.parse(text)) {
      case Result.Ok<TimeOfDay, String>(var value) -> Optional.of(value);
      case Result.Err<TimeOfDay, String>(var problem) -> {
        fail(path, problem);
        yield Optional.empty();
      }
    };
  }

  private void requirePlace(String place, String path) {
    if (!NpcBrain.HOME.equals(place) && !places.contains(place)) {
      fail(path, "place " + place + " is not defined under places (or use home)");
    }
  }

  private void fail(String path, String message) {
    failed = true;
    problems.add(located, path, message);
  }
}
