package com.shepherdjerred.thestorm.world.adapter.db;

import static com.shepherdjerred.thestorm.world.adapter.db.generated.Tables.WORLD_DIGEST_ARRIVAL;
import static com.shepherdjerred.thestorm.world.adapter.db.generated.Tables.WORLD_DIGEST_DAY;
import static java.util.Objects.requireNonNull;
import static org.jooq.impl.DSL.inline;
import static org.jooq.impl.DSL.least;

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
          dsl.insertInto(WORLD_DIGEST_ARRIVAL)
              .set(WORLD_DIGEST_ARRIVAL.DAY, date.toEpochDay())
              .set(WORLD_DIGEST_ARRIVAL.PLAYER_UUID, player.toString())
              .onConflictDoNothing()
              .execute();
        });
  }

  @Override
  public CompletableFuture<Void> recordDeath(LocalDate date, Instant at) {
    return write(
        dsl -> {
          ensureDay(dsl, date, at);
          dsl.update(WORLD_DIGEST_DAY)
              .set(WORLD_DIGEST_DAY.DEATHS, WORLD_DIGEST_DAY.DEATHS.add(1))
              .where(WORLD_DIGEST_DAY.DAY.eq(date.toEpochDay()))
              .execute();
        });
  }

  @Override
  public CompletableFuture<Optional<DailyReport>> read(LocalDate date) {
    return database.read(
        dsl -> {
          var day =
              dsl.selectFrom(WORLD_DIGEST_DAY)
                  .where(WORLD_DIGEST_DAY.DAY.eq(date.toEpochDay()))
                  .fetchOne();
          if (day == null) {
            return Optional.empty();
          }
          var visits =
              dsl.fetchCount(WORLD_DIGEST_ARRIVAL, WORLD_DIGEST_ARRIVAL.DAY.eq(date.toEpochDay()));
          return Optional.of(
              new DailyReport(
                  date,
                  Instant.ofEpochMilli(requireNonNull(day.getFirstObservedMs())),
                  visits,
                  requireNonNull(day.getDeaths())));
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
    dsl.insertInto(WORLD_DIGEST_DAY)
        .set(WORLD_DIGEST_DAY.DAY, day)
        .set(WORLD_DIGEST_DAY.FIRST_OBSERVED_MS, millis)
        .set(WORLD_DIGEST_DAY.DEATHS, 0)
        .onConflictDoNothing()
        .execute();
    dsl.update(WORLD_DIGEST_DAY)
        .set(
            WORLD_DIGEST_DAY.FIRST_OBSERVED_MS,
            least(WORLD_DIGEST_DAY.FIRST_OBSERVED_MS, inline(millis)))
        .where(WORLD_DIGEST_DAY.DAY.eq(day))
        .execute();
  }
}
