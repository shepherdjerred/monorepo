package com.shepherdjerred.thestorm.world.adapter.db;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.world.app.DailyLedger;
import com.shepherdjerred.thestorm.world.domain.DailyReport;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.jooq.DSLContext;

/** One-writer transactions keep each day's coverage marker and counts consistent. */
public final class JooqDailyLedger implements DailyLedger {

  private final StormDatabase database;

  public JooqDailyLedger(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> recordArrival(LocalDate date, UUID player, Instant at) {
    return write(
        dsl -> {
          ensureDay(dsl, date, at);
          dsl.execute(
              "INSERT OR IGNORE INTO world_digest_arrival (day, player_uuid) VALUES (?, ?)",
              date.toEpochDay(),
              player.toString());
        });
  }

  @Override
  public CompletableFuture<Void> recordDeath(LocalDate date, Instant at) {
    return write(
        dsl -> {
          ensureDay(dsl, date, at);
          dsl.execute(
              "UPDATE world_digest_day SET deaths = deaths + 1 WHERE day = ?", date.toEpochDay());
        });
  }

  @Override
  public CompletableFuture<Optional<DailyReport>> read(LocalDate date) {
    return database.read(
        dsl -> {
          var day =
              dsl.fetchOne(
                  "SELECT first_observed_ms, deaths FROM world_digest_day WHERE day = ?",
                  date.toEpochDay());
          if (day == null) {
            return Optional.empty();
          }
          var visits =
              requireNonNull(
                  dsl.fetchOne(
                      "SELECT COUNT(*) AS arrivals FROM world_digest_arrival WHERE day = ?",
                      date.toEpochDay()));
          return Optional.of(
              new DailyReport(
                  date,
                  Instant.ofEpochMilli(requireNonNull(day.get("first_observed_ms", Long.class))),
                  requireNonNull(visits.get("arrivals", Integer.class)),
                  requireNonNull(day.get("deaths", Integer.class))));
        });
  }

  private CompletableFuture<Void> write(Consumer<DSLContext> work) {
    return database
        .write(
            dsl -> {
              work.accept(dsl);
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }

  private static void ensureDay(DSLContext dsl, LocalDate date, Instant at) {
    var day = date.toEpochDay();
    var millis = at.toEpochMilli();
    dsl.execute(
        "INSERT OR IGNORE INTO world_digest_day (day, first_observed_ms, deaths) VALUES (?, ?, 0)",
        day,
        millis);
    dsl.execute(
        "UPDATE world_digest_day SET first_observed_ms = MIN(first_observed_ms, ?) WHERE day = ?",
        millis,
        day);
  }
}
