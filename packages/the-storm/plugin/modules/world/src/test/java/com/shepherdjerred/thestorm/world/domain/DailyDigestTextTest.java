package com.shepherdjerred.thestorm.world.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class DailyDigestTextTest {

  private static final LocalDate DATE = LocalDate.of(2026, 9, 27);
  private static final ZoneId PACIFIC = ZoneId.of("America/Los_Angeles");

  @Test
  void reportsOnlyRecordedActivityWithCoverageAndCurrentWeather() {
    var report = new DailyReport(DATE, Instant.parse("2026-09-27T18:30:00Z"), 3, 2);
    var view =
        new DailyDigestText.View(
            DATE, Optional.of(report), new DailyDigestText.WorldNow(4, true, true), PACIFIC);

    assertThat(DailyDigestText.lines(view))
        .containsExactly(
            "Hear ye! Main-world record for Sep 27, 2026: 3 distinct player arrivals and 2 player deaths recorded since 11:30 AM PDT.",
            "Right now, 4 players are in the main world and thunder rolls.");
  }

  @Test
  void emptyLedgerIsExplicitAndWeatherSnapshotIsFresh() {
    var view =
        new DailyDigestText.View(
            DATE, Optional.empty(), new DailyDigestText.WorldNow(0, false, false), PACIFIC);

    assertThat(DailyDigestText.lines(view))
        .containsExactly(
            "Hear ye! Main-world record for Sep 27, 2026: No main-world activity has been recorded for this date.",
            "Right now, 0 players are in the main world and the skies are clear.");
  }

  @Test
  void rejectsReportForAnotherDateAndNegativeCounts() {
    var yesterday = new DailyReport(DATE.minusDays(1), Instant.EPOCH, 1, 0);
    assertThatThrownBy(
            () ->
                new DailyDigestText.View(
                    DATE,
                    Optional.of(yesterday),
                    new DailyDigestText.WorldNow(1, false, false),
                    PACIFIC))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new DailyReport(DATE, Instant.EPOCH, -1, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new DailyDigestText.WorldNow(-1, false, false))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
