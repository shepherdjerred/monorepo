package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.model.Quest.Repeat;
import com.shepherdjerred.thestorm.quests.domain.state.Completion;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.Optional;

/**
 * Days and weeks in the server's time zone, for repeatable quests and the board.
 *
 * @param zone the time zone days are counted in
 * @param weekStart the first day of a week
 */
public record Calendar(ZoneId zone, DayOfWeek weekStart) {

  /** The local date at {@code now}. */
  public LocalDate day(Instant now) {
    return LocalDate.ofInstant(now, zone);
  }

  /** The first day of the week containing {@code now}. */
  public LocalDate week(Instant now) {
    return day(now).with(TemporalAdjusters.previousOrSame(weekStart));
  }

  /** Whether a quest with {@code repeat}, last completed as {@code last}, may be taken now. */
  public boolean available(Repeat repeat, Optional<Completion> last, Instant now) {
    if (last.isEmpty()) {
      return true;
    }
    var done = last.get().last();
    return switch (repeat) {
      case ONCE -> false;
      case DAILY -> day(done).isBefore(day(now));
      case WEEKLY -> week(done).isBefore(week(now));
    };
  }
}
