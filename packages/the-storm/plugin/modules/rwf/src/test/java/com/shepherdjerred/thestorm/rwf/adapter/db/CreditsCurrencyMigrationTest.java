package com.shepherdjerred.thestorm.rwf.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PayoutStatus;
import java.io.InputStream;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * V2 gives every payout row a currency. Rows written before it were paid in crystals, so they keep
 * every column and become {@code crystals}; a row a crash left paying still settles in crystals.
 * The daily-earnings table stays, for those legacy rows' cap.
 */
final class CreditsCurrencyMigrationTest {

  private static final UUID MATCH = new UUID(5, 1);

  @TempDir Path directory;

  private StormDatabase database;

  @BeforeEach
  void openAtVersionOne() throws Exception {
    var migrations = directory.resolve("v1/db/migration/rwf");
    Files.createDirectories(migrations);
    try (InputStream in =
        Objects.requireNonNull(
            CreditsCurrencyMigrationTest.class.getResourceAsStream(
                "/db/migration/rwf/V1__rwf.sql"))) {
      Files.copy(in, migrations.resolve("V1__rwf.sql"));
    }
    database = StormDatabase.open(directory.resolve("t.db"));
    try (var v1 =
        new URLClassLoader(
            new URL[] {directory.resolve("v1").toUri().toURL()},
            ClassLoader.getPlatformClassLoader())) {
      database.migrate("rwf", v1);
    }
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(30, TimeUnit.SECONDS);
  }

  private void sql(String statement, Object... bindings) throws Exception {
    await(database.write(dsl -> dsl.execute(statement, bindings)));
  }

  private List<List<Object>> rows(String query) throws Exception {
    return await(
        database.read(
            dsl ->
                dsl.fetch(query).stream()
                    .map(record -> Arrays.asList(record.intoArray()))
                    .toList()));
  }

  @Test
  void everyPayoutRowIsKeptAndPaysInCrystals() throws Exception {
    sql(
        "INSERT INTO rwf_match (id, map, started_at, ended_at, winner, humans, bots,"
            + " recording_bytes, dropped_frames) VALUES (?, 'training-yard', 1, 2, 'RED', 3, 5,"
            + " 0, 0)",
        MATCH.toString());
    var players =
        List.of(
            List.of(new UUID(6, 1), "WIN", 3L, PayoutStatus.PAID, 3L),
            List.of(new UUID(6, 2), "LOSE", 1L, PayoutStatus.PAYING, 0L),
            List.of(new UUID(6, 3), "WIN", 3L, PayoutStatus.PENDING, 0L),
            List.of(new UUID(6, 4), "LEFT", 0L, PayoutStatus.NONE, 0L));
    for (var player : players) {
      sql(
          "INSERT INTO rwf_match_player (match_id, player, team, kit, kills, deaths, result,"
              + " credits_owed, payout_status, credits_paid) VALUES (?, ?, 'RED', 'trooper', 2, 1,"
              + " ?, ?, ?, ?)",
          MATCH.toString(),
          player.get(0).toString(),
          player.get(1),
          player.get(2),
          player.get(3).toString(),
          player.get(4));
    }
    sql("INSERT INTO rwf_daily_earnings (player, day, credits) VALUES ('x', '2026-10-01', 4)");
    var columns =
        "match_id, player, team, kit, kills, deaths, result, credits_owed, payout_status,"
            + " credits_paid";
    var before = rows("SELECT " + columns + " FROM rwf_match_player ORDER BY player");

    database.migrate("rwf", CreditsCurrencyMigrationTest.class.getClassLoader());

    assertThat(rows("SELECT " + columns + " FROM rwf_match_player ORDER BY player"))
        .isEqualTo(before);
    assertThat(rows("SELECT DISTINCT currency FROM rwf_match_player"))
        .containsExactly(List.of(CurrencyId.CRYSTALS.key()));
    assertThat(rows("SELECT player, day, credits FROM rwf_daily_earnings"))
        .as("legacy crystal rows still settle under the old cap")
        .containsExactly(List.of("x", "2026-10-01", 4L));
    var store = new JooqMatchStore(database);
    assertThat(await(store.unpaid()))
        .hasSize(2)
        .allSatisfy(row -> assertThat(row.currency()).isEqualTo(CurrencyId.CRYSTALS));
    assertThat(await(store.beginPayout(MATCH, new UUID(6, 2), LocalDate.of(2026, 10, 1))))
        .as("a row a crash left paying keeps what it reserved")
        .isZero();
  }
}
