package com.shepherdjerred.thestorm.core.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.sum;
import static org.jooq.impl.DSL.table;

import java.nio.file.Path;
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
}
