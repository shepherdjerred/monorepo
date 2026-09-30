package com.shepherdjerred.thestorm.world.domain;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Formats only recorded events and a fresh main-world snapshot; it invents no town or trade facts.
 */
public final class DailyDigestText {

  private static final DateTimeFormatter DATE =
      DateTimeFormatter.ofPattern("MMM d, uuuu", Locale.US);
  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("h:mm a z", Locale.US);

  private DailyDigestText() {}

  public record WorldNow(int online, boolean storming, boolean thundering) {
    public WorldNow {
      if (online < 0) {
        throw new IllegalArgumentException("online count cannot be negative");
      }
    }
  }

  public record View(LocalDate date, Optional<DailyReport> recorded, WorldNow now, ZoneId zone) {
    public View {
      if (recorded.isPresent() && !recorded.orElseThrow().date().equals(date)) {
        throw new IllegalArgumentException("digest report date differs from requested date");
      }
    }
  }

  public static List<String> lines(View view) {
    var activity =
        view.recorded()
            .map(
                report ->
                    report.arrivals()
                        + " distinct player arrivals and "
                        + report.deaths()
                        + " player deaths recorded since "
                        + TIME.withZone(view.zone()).format(report.firstObserved())
                        + ".")
            .orElse("No main-world activity has been recorded for this date.");
    var weather =
        view.now().thundering()
            ? "thunder rolls"
            : view.now().storming() ? "rain falls" : "the skies are clear";
    return List.of(
        "Hear ye! Main-world record for " + DATE.format(view.date()) + ": " + activity,
        "Right now, "
            + view.now().online()
            + " players are in the main world and "
            + weather
            + ".");
  }
}
