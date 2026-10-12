package com.shepherdjerred.thestorm.quests.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.table;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Deployed migration bytes are immutable; existing quest data must survive a forward upgrade. */
final class QuestsMigrationTest {

  @TempDir Path directory;

  @Test
  void deployedVersionOneHasItsOriginalChecksum() throws Exception {
    try (var source =
        Objects.requireNonNull(
            getClass().getResourceAsStream("/db/migration/quests/V1__quest_state.sql"))) {
      assertThat(
              HexFormat.of()
                  .formatHex(MessageDigest.getInstance("SHA-256").digest(source.readAllBytes())))
          .isEqualTo("26ef26edf4f8b32086c3b7c9ba10158fe82a73cdc162a4ff426eae691e19092c");
    }
  }

  @Test
  void aDeployedDatabaseUpgradesWithoutRepairingHistoryOrReplacingPlayers() throws Exception {
    var resources = directory.resolve("deployed/db/migration/quests");
    Files.createDirectories(resources);
    for (var name :
        List.of(
            "V1__quest_state.sql",
            "V2__pending_world_effects.sql",
            "V3__pending_world_delivery_state.sql",
            "V4__collections.sql")) {
      try (var source =
          Objects.requireNonNull(getClass().getResourceAsStream("/db/migration/quests/" + name))) {
        Files.copy(source, resources.resolve(name));
      }
    }
    var file = directory.resolve("upgrade.db");
    try (var loader =
            new URLClassLoader(
                new java.net.URL[] {directory.resolve("deployed").toUri().toURL()}, null);
        var database = StormDatabase.open(file)) {
      database.migrate("quests", loader);
      database
          .write(
              dsl ->
                  dsl.execute(
                      "INSERT INTO quests_player (player_id, points, board_day, board_week) VALUES (?, ?, ?, ?)",
                      "69aef4f7-91d0-4f09-aef1-c721307aa45c",
                      12,
                      "2026-10-06",
                      "2026-10-05"))
          .join();
    }
    try (var database = StormDatabase.open(file)) {
      database.migrate("quests", getClass().getClassLoader());
      assertThat(
              database
                  .read(
                      dsl ->
                          dsl.select(field("points", Long.class))
                              .from(table("quests_player"))
                              .fetchSingle()
                              .value1())
                  .join())
          .isEqualTo(12);
      assertThat(
              database
                  .read(
                      dsl ->
                          dsl.select(field("version", String.class))
                              .from(table("flyway_quests_history"))
                              .where(field("version").isNotNull())
                              .orderBy(field("installed_rank"))
                              .fetch(field("version", String.class)))
                  .join())
          .containsExactly("1", "2", "3", "4");
    }
  }
}
