package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.adapter.db.JooqQolStore;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class StarterRtpPersistenceTest {
  @TempDir Path directory;

  @Test
  void existingRowsDoNotReceiveANewStarterCompass() {
    try (var database = StormDatabase.open(directory.resolve("existing.db"))) {
      database.migrate("qol", getClass().getClassLoader());
      var player = UUID.randomUUID();
      database
          .write(
              dsl ->
                  dsl.execute(
                      "INSERT INTO qol_player (player, first_seen) VALUES (?, ?)",
                      player.toString(),
                      0L))
          .join();
      var ensured = new JooqQolStore(database).ensure(player, Instant.EPOCH).join();
      assertThat(ensured.created()).isFalse();
      assertThat(ensured.profile().starterRtpPending()).isFalse();
    }
  }

  @Test
  void searchesDoNotConsumeTheCompassAndCompletedTravelSurvivesRestart() {
    var path = directory.resolve("qol.db");
    var player = UUID.randomUUID();
    var now = Instant.parse("2026-10-18T00:00:00Z");
    try (var database = StormDatabase.open(path)) {
      database.migrate("qol", getClass().getClassLoader());
      var store = new JooqQolStore(database);
      assertThat(store.ensure(player, now).join().profile().starterRtpPending()).isTrue();
      store.setLastRtp(player, now).join();
      assertThat(store.ensure(player, now.plusSeconds(1)).join().profile().starterRtpPending())
          .isTrue();
    }
    try (var database = StormDatabase.open(path)) {
      var store = new JooqQolStore(database);
      assertThat(store.ensure(player, now).join().profile().starterRtpPending()).isTrue();
      store.completeStarterRtp(player).join();
    }
    try (var database = StormDatabase.open(path)) {
      var store = new JooqQolStore(database);
      var returning = store.ensure(player, now.plusSeconds(2)).join();
      assertThat(returning.created()).isFalse();
      assertThat(returning.profile().starterRtpPending()).isFalse();
      assertThat(returning.profile().firstSeen()).isEqualTo(now);
    }
  }
}
