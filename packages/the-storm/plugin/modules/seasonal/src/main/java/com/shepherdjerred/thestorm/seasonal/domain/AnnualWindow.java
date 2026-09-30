package com.shepherdjerred.thestorm.seasonal.domain;

import java.time.LocalDate;
import java.time.MonthDay;

/** Inclusive month-day window; an end before a start wraps across New Year. */
public record AnnualWindow(MonthDay start, MonthDay end) {

  public boolean contains(LocalDate day) {
    var current = MonthDay.from(day);
    if (start.compareTo(end) <= 0) {
      return current.compareTo(start) >= 0 && current.compareTo(end) <= 0;
    }
    return current.compareTo(start) >= 0 || current.compareTo(end) <= 0;
  }
}
