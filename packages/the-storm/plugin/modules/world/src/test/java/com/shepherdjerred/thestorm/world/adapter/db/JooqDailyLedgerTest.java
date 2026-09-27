package com.shepherdjerred.thestorm.world.adapter.db;

import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.world.domain.DailyReport;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqDailyLedgerTest {

  @TempDir Path directory;

  private StormDatabase database;
  private JooqDailyLedger ledger;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("world.db"));
    database.migrate("world", JooqDailyLedgerTest.class.getClassLoader());
    ledger = new JooqDailyLedger(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void deduplicatesArrivalsAndPersistsDeathsPerLocalDate() throws Exception {
    var day = LocalDate.of(2026, 9, 27);
    var first = Instant.parse("2026-09-27T18:30:00Z");
    var earlier = first.minusSeconds(30);
    var player = randomUUID();
    var other = randomUUID();

    assertThat(await(ledger.read(day))).isEqualTo(Optional.empty());
    await(ledger.recordArrival(day, player, first));
    await(ledger.recordArrival(day, player, first.plusSeconds(60)));
    await(ledger.recordArrival(day, other, earlier));
    await(ledger.recordDeath(day, first.plusSeconds(10)));
    await(ledger.recordDeath(day, first.plusSeconds(20)));
    await(ledger.recordArrival(day.plusDays(1), player, first.plusSeconds(86400)));

    assertThat(await(ledger.read(day))).contains(new DailyReport(day, earlier, 2, 2));
    assertThat(await(ledger.read(day.plusDays(1))))
        .contains(new DailyReport(day.plusDays(1), first.plusSeconds(86400), 1, 0));

    database.close();
    database = StormDatabase.open(directory.resolve("world.db"));
    database.migrate("world", JooqDailyLedgerTest.class.getClassLoader());
    ledger = new JooqDailyLedger(database);
    assertThat(await(ledger.read(day))).contains(new DailyReport(day, earlier, 2, 2));
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
