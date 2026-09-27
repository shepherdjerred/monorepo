package com.shepherdjerred.thestorm.world.domain;

import java.time.Instant;
import java.time.LocalDate;

/** Events recorded since the first observed main-world activity on this local date. */
public record DailyReport(LocalDate date, Instant firstObserved, int arrivals, int deaths) {

  public DailyReport {
    if (arrivals < 0 || deaths < 0) {
      throw new IllegalArgumentException("daily activity counts cannot be negative");
    }
  }
}
