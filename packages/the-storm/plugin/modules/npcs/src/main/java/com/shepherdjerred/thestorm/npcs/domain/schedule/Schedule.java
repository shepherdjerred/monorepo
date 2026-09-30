package com.shepherdjerred.thestorm.npcs.domain.schedule;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * A daily routine. Its slots cover every minute of the day exactly once, so there is always exactly
 * one current activity.
 *
 * @param id the content id
 * @param slots the routine, in any order
 * @param shelter the place to go while it rains or storms; empty to ignore the weather
 */
public record Schedule(String id, List<Slot> slots, Optional<String> shelter) {

  /** One part of the day. */
  public record Slot(TimeRange range, Activity activity) {}

  private static final int UNOWNED = -1;

  public Schedule {
    slots = List.copyOf(slots);
    var problems = problems(slots);
    if (!problems.isEmpty()) {
      throw new IllegalArgumentException(String.join("; ", problems));
    }
  }

  /** The activity at {@code time}. */
  public Activity activityAt(TimeOfDay time) {
    for (var slot : slots) {
      if (slot.range().contains(time)) {
        return slot.activity();
      }
    }
    throw new IllegalStateException("schedule " + id + " does not cover " + time);
  }

  /**
   * Why {@code slots} are not a valid day: empty, overlapping, or leaving minutes uncovered. Empty
   * when they cover every minute exactly once.
   */
  public static List<String> problems(List<Slot> slots) {
    if (slots.isEmpty()) {
      return List.of("a schedule needs at least one slot");
    }
    var problems = new ArrayList<String>();
    var owner = new int[TimeOfDay.DAY];
    Arrays.fill(owner, UNOWNED);
    for (var index = 0; index < slots.size(); index++) {
      var slot = slots.get(index);
      var start = slot.range().from().minute();
      var overlapped = UNOWNED;
      for (var offset = 0; offset < slot.range().minutes(); offset++) {
        var minute = (start + offset) % TimeOfDay.DAY;
        var other = owner[minute];
        if (other == UNOWNED) {
          owner[minute] = index;
        } else if (other != overlapped) {
          // Reported once per pair of slots, at the first shared minute.
          overlapped = other;
          problems.add(
              "slots "
                  + slots.get(other).range()
                  + " and "
                  + slot.range()
                  + " overlap at "
                  + new TimeOfDay(minute));
        }
      }
    }
    gaps(owner).forEach(gap -> problems.add("no slot covers " + gap));
    return problems;
  }

  private static List<TimeRange> gaps(int[] owner) {
    var gaps = new ArrayList<TimeRange>();
    var minute = 0;
    while (minute < TimeOfDay.DAY) {
      if (owner[minute] != UNOWNED) {
        minute++;
        continue;
      }
      var start = minute;
      while (minute < TimeOfDay.DAY && owner[minute] == UNOWNED) {
        minute++;
      }
      gaps.add(new TimeRange(new TimeOfDay(start), new TimeOfDay(minute % TimeOfDay.DAY)));
    }
    return gaps;
  }

  /** The slots sorted by start time, for display. */
  public List<Slot> sorted() {
    return slots.stream().sorted(Comparator.comparing(slot -> slot.range().from())).toList();
  }
}
