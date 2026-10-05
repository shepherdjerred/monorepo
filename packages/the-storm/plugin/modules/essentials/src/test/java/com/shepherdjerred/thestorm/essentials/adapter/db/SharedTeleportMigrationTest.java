package com.shepherdjerred.thestorm.essentials.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.app.TeleportAttempt;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SharedTeleportMigrationTest {
  @TempDir Path directory;

  @Test
  void upgradePreservesTheLongestCooldownAndPendingPaymentsAndAllowsRtp() throws Exception {
    var player = UUID.randomUUID();
    var t0 = Instant.parse("2026-09-25T12:00:00Z");
    var pending = new TeleportAttempt(UUID.randomUUID(), player, TeleportKind.HOME, 25);
    try (var database = StormDatabase.open(directory.resolve("legacy.db"))) {
      for (var name :
          List.of("V1__essentials.sql", "V2__kit_deliveries.sql", "V3__teleport_attempts.sql")) {
        apply(database, name);
      }
      database
          .write(
              dsl -> {
                dsl.execute(
                    "INSERT INTO essentials_teleport_usage VALUES (?, ?, ?, ?, ?)",
                    player.toString(),
                    "home",
                    350,
                    t0.toEpochMilli(),
                    t0.plusSeconds(120).toEpochMilli());
                dsl.execute(
                    "INSERT INTO essentials_teleport_usage VALUES (?, ?, ?, ?, ?)",
                    player.toString(),
                    "spawn",
                    200,
                    t0.toEpochMilli(),
                    t0.plusSeconds(30).toEpochMilli());
                return Boolean.TRUE;
              })
          .join();
      var attempts = new JooqTeleportAttemptStore(database);
      attempts.insert(pending).join();

      apply(database, "V4__shared_teleport_usage.sql");

      var usage =
          new JooqTeleportUsageStore(database)
              .find(player, t0.minusSeconds(3600))
              .join()
              .orElseThrow();
      assertThat(usage.cooldownUntil()).isEqualTo(t0.plusSeconds(120));
      assertThat(usage.trips()).isEmpty();
      assertThat(attempts.pending().join()).containsExactly(pending);
      var rtp = new TeleportAttempt(UUID.randomUUID(), player, TeleportKind.RTP, 25);
      attempts.insert(rtp).join();
      assertThat(attempts.pending().join()).containsExactlyInAnyOrder(pending, rtp);
    }
  }

  private static void apply(StormDatabase database, String name) throws Exception {
    var sql = Files.readString(Path.of("src/main/resources/db/migration/essentials", name));
    database
        .write(
            dsl -> {
              for (var statement : sql.split(";", -1)) {
                if (!statement.isBlank()) {
                  dsl.execute(statement);
                }
              }
              return Boolean.TRUE;
            })
        .join();
  }
}
