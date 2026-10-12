package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** An operator's quarantines outlast a restart: they are read back from the database. */
final class JooqQuarantineStoreTest {

  @TempDir Path directory;

  @Test
  void aQuarantineIsKeptAcrossARestartUntilItIsReleased() {
    var file = directory.resolve("t.db");
    try (var database = StormDatabase.open(file)) {
      database.migrate("rwf", getClass().getClassLoader());
      var store = new JooqQuarantineStore(database);
      store.quarantine("harbour", "a bomb nobody can reach", "Op", T0).join();
      store.quarantine("harbour", "still broken", "Op", T0.plusSeconds(5)).join();
      store.quarantine("canyon", "testing", "Op", T0).join();
    }
    try (var database = StormDatabase.open(file)) {
      database.migrate("rwf", getClass().getClassLoader());
      var store = new JooqQuarantineStore(database);

      assertThat(store.all().join())
          .isEqualTo(Map.of("harbour", "still broken", "canyon", "testing"));
      store.release("canyon").join();
      assertThat(store.all().join()).containsOnlyKeys("harbour");
    }
  }
}
