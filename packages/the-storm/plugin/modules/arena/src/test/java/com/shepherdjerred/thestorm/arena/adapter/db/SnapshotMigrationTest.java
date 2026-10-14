package com.shepherdjerred.thestorm.arena.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.core.snapshot.Vitals;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Runs the additive migration against actual historical SQLite rows, including retired rows. */
final class SnapshotMigrationTest {
  @TempDir Path directory;

  @Test
  void historicalSnapshotsRetainTheirVersionAndExplicitModeSemantics() throws Exception {
    var file = directory.resolve("historical.db");
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + file)) {
      migrate(connection, "V1__arena.sql");
      migrate(connection, "V2__restored_snapshots.sql");
      var modes = List.of("SURVIVAL", "CREATIVE", "SPECTATOR", "ADVENTURE");
      for (var i = 0; i < modes.size(); i++) {
        try (var insert =
            connection.prepareStatement(
                "INSERT INTO arena_snapshots "
                    + "(player, arena, world, x, y, z, yaw, pitch, health, food, saturation, exhaustion, "
                    + "game_mode, level, progress, total_experience, inventory, taken_at, restored_at) "
                    + "VALUES (?, 'rwf', 'world', 0, 64, 0, 0, 0, 20, 20, 5, 0, ?, 7, 0, 0, ?, 1, ?)")) {
          insert.setString(1, new UUID(0, i + 1).toString());
          insert.setString(2, modes.get(i));
          insert.setBytes(3, new byte[] {1, 2, 3});
          if (i == 3) {
            insert.setLong(4, 2);
          } else {
            insert.setNull(4, java.sql.Types.BIGINT);
          }
          insert.executeUpdate();
        }
      }
      migrate(connection, "V6__snapshot_flight_and_immunity.sql");
    }
    try (var database = StormDatabase.open(file)) {
      var snapshots = new JooqSnapshotStore(database).loadAll().join();
      assertThat(snapshots).hasSize(3);
      assertThat(snapshots)
          .extracting(Snapshot::vitals)
          .containsExactlyInAnyOrder(
              new Vitals(new Vitals.Condition(20, 20, 5, 0), "SURVIVAL"),
              new Vitals(new Vitals.Condition(20, 20, 5, 0), "CREATIVE"),
              new Vitals(new Vitals.Condition(20, 20, 5, 0), "SPECTATOR"));
      assertThat(snapshots)
          .allSatisfy(
              snapshot -> {
                assertThat(snapshot.vitals().formatVersion()).isEqualTo(1);
                assertThat(snapshot.vitals().maximumNoDamageTicks()).isEqualTo(20);
              });
    }
  }

  private static void migrate(Connection connection, String migration)
      throws IOException, SQLException {
    try (var resource =
        SnapshotMigrationTest.class.getResourceAsStream("/db/migration/arena/" + migration)) {
      if (resource == null) {
        throw new IllegalStateException("missing historical migration " + migration);
      }
      var sql =
          new String(resource.readAllBytes(), StandardCharsets.UTF_8).replaceAll("(?m)--.*$", "");
      try (var statement = connection.createStatement()) {
        for (var command : java.util.regex.Pattern.compile(";").splitAsStream(sql).toList()) {
          if (!command.isBlank()) {
            statement.execute(command);
          }
        }
      }
    }
  }
}
