package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.adapter.db.JooqQolStore;
import com.shepherdjerred.thestorm.qol.app.PlayerProfile;
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
      assertThat(ensured.profile().starterRtpCharges()).isZero();
    }
  }

  @Test
  void aPendingOneShotCompassBecomesEightCharges() throws Exception {
    try (var database = StormDatabase.open(directory.resolve("pending.db"))) {
      for (var name :
          java.util.List.of(
              "V1__qol.sql",
              "V2__rtp_attempts.sql",
              "V3__grave_storage.sql",
              "V4__grave_handoffs.sql",
              "V5__starter_rtp.sql")) {
        apply(database, name);
      }
      var player = UUID.randomUUID();
      database
          .write(
              dsl ->
                  dsl.execute(
                      "INSERT INTO qol_player (player, first_seen, starter_rtp_pending) VALUES (?, ?, 1)",
                      player.toString(),
                      0L))
          .join();
      apply(database, "V6__starter_charges.sql");
      assertThat(
              new JooqQolStore(database)
                  .ensure(player, Instant.EPOCH)
                  .join()
                  .profile()
                  .starterRtpCharges())
          .isEqualTo(PlayerProfile.STARTER_CHARGES);
    }
  }

  private static void apply(StormDatabase database, String name) throws Exception {
    var sql =
        java.nio.file.Files.readString(
                java.nio.file.Path.of("src/main/resources/db/migration/qol", name))
            .lines()
            .filter(line -> !line.stripLeading().startsWith("--"))
            .collect(java.util.stream.Collectors.joining("\n"));
    database
        .write(
            dsl -> {
              for (var statement : sql.split(";", -1)) {
                if (!statement.isBlank()) dsl.execute(statement);
              }
              return Boolean.TRUE;
            })
        .join();
  }

  @Test
  void searchesDoNotConsumeTheCompassAndALandingSpendsOneCharge() {
    var path = directory.resolve("qol.db");
    var player = UUID.randomUUID();
    var now = Instant.parse("2026-10-18T00:00:00Z");
    try (var database = StormDatabase.open(path)) {
      database.migrate("qol", getClass().getClassLoader());
      var store = new JooqQolStore(database);
      assertThat(store.ensure(player, now).join().profile().starterRtpCharges())
          .isEqualTo(PlayerProfile.STARTER_CHARGES);
      store.setLastRtp(player, now).join();
      assertThat(store.ensure(player, now.plusSeconds(1)).join().profile().starterRtpCharges())
          .isEqualTo(PlayerProfile.STARTER_CHARGES);
      assertThat(store.spendStarterCharge(player).join()).isEqualTo(7);
    }
    try (var database = StormDatabase.open(path)) {
      var store = new JooqQolStore(database);
      var returning = store.ensure(player, now.plusSeconds(2)).join();
      assertThat(returning.created()).isFalse();
      assertThat(returning.profile().starterRtpCharges()).isEqualTo(7);
      assertThat(returning.profile().firstSeen()).isEqualTo(now);
      for (var left = 7; left > 0; left--) {
        assertThat(store.spendStarterCharge(player).join()).isEqualTo(left - 1);
      }
      assertThat(store.ensure(player, now.plusSeconds(3)).join().profile().starterRtpCharges())
          .isZero();
    }
  }
}
