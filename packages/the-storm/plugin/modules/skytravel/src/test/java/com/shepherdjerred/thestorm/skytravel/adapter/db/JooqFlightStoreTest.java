package com.shepherdjerred.thestorm.skytravel.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.skytravel.domain.FlightLease;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqFlightStoreTest {
  @TempDir Path directory;

  @Test
  void reopeningPreservesOriginalDeadlinesAndResetTouchesOnlyOnePlayer() {
    var file = directory.resolve("flights.db");
    var now = Instant.parse("2026-11-07T12:00:00Z");
    var alice =
        new FlightLease(
            UUID.fromString("00000000-0000-0000-0000-000000000001"),
            FlightLease.Phase.ASCENT,
            now.plusSeconds(120),
            now.plusSeconds(150),
            now.plusSeconds(15));
    var bob =
        new FlightLease(
            UUID.fromString("00000000-0000-0000-0000-000000000002"),
            FlightLease.Phase.DESCENT,
            now.plusSeconds(120),
            now.plusSeconds(150),
            now.plusSeconds(15));
    try (var database = StormDatabase.open(file)) {
      database.migrate("skytravel", getClass().getClassLoader());
      var store = new JooqFlightStore(database);
      store.save(alice).join();
      store.save(alice.phase(FlightLease.Phase.GLIDE)).join();
      store.save(bob).join();
    }
    try (var database = StormDatabase.open(file)) {
      var store = new JooqFlightStore(database);
      assertThat(store.load().join())
          .containsExactlyInAnyOrder(alice.phase(FlightLease.Phase.GLIDE), bob);
      store.reset(alice.player()).join();
      assertThat(store.load().join()).containsExactly(bob);
    }
  }
}
