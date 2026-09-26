package com.shepherdjerred.thestorm.core.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.sum;
import static org.jooq.impl.DSL.table;

import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class StormDatabaseTest {

  @Test
  void migratesAndSerializesWrites(@TempDir Path directory) throws Exception {
    try (var database = StormDatabase.open(directory.resolve("test.db"))) {
      database.migrate("sample", StormDatabaseTest.class.getClassLoader());

      for (var amount = 1; amount <= 10; amount++) {
        var value = amount;
        database
            .write(
                dsl ->
                    dsl.insertInto(table("ledger"), field("player"), field("amount"))
                        .values("RiotShielder", value)
                        .execute())
            .get(5, TimeUnit.SECONDS);
      }

      var total =
          database
              .read(
                  dsl ->
                      dsl.select(sum(field("amount", Integer.class)))
                          .from(table("ledger"))
                          .fetchSingle()
                          .value1()
                          .intValue())
              .get(5, TimeUnit.SECONDS);

      assertThat(total).isEqualTo(55);
    }
  }

  @Test
  void aReadSeesWritesQueuedBeforeIt(@TempDir Path directory) throws Exception {
    try (var database = StormDatabase.open(directory.resolve("test.db"))) {
      database.migrate("sample", StormDatabaseTest.class.getClassLoader());
      var release = new CountDownLatch(1);

      var slowWrite =
          database.write(
              dsl -> {
                awaitQuietly(release);
                return dsl.insertInto(table("ledger"), field("player"), field("amount"))
                    .values("RiotShielder", 7)
                    .execute();
              });
      var count = database.read(dsl -> dsl.fetchCount(table("ledger")));
      release.countDown();

      assertThat(count.get(5, TimeUnit.SECONDS)).isEqualTo(1);
      assertThat(slowWrite.get(5, TimeUnit.SECONDS)).isEqualTo(1);
    }
  }

  private static void awaitQuietly(CountDownLatch latch) {
    try {
      if (!latch.await(5, TimeUnit.SECONDS)) {
        throw new IllegalStateException("latch was never released");
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(e);
    }
  }

  @Test
  void migrationsAreRecordedPerModule(@TempDir Path directory) throws Exception {
    try (var database = StormDatabase.open(directory.resolve("test.db"))) {
      database.migrate("sample", StormDatabaseTest.class.getClassLoader());
      database.migrate("sample", StormDatabaseTest.class.getClassLoader());

      var applied =
          database
              .read(dsl -> dsl.fetchCount(table("flyway_sample_history")))
              .get(5, TimeUnit.SECONDS);

      assertThat(applied).isEqualTo(1);
    }
  }

  @Test
  void aSecondModuleMigratesIntoADatabaseThatAlreadyHasTables(@TempDir Path directory)
      throws Exception {
    try (var database = StormDatabase.open(directory.resolve("test.db"))) {
      database.migrate("sample", StormDatabaseTest.class.getClassLoader());
      database.migrate("second", StormDatabaseTest.class.getClassLoader());

      var tables =
          database.read(dsl -> dsl.fetchCount(table("second_things"))).get(5, TimeUnit.SECONDS);

      assertThat(tables).isZero();
    }
  }
}
