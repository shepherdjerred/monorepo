package com.shepherdjerred.thestorm.economy.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;
import java.io.InputStream;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * V4 rebuilds the balance and ledger tables with a currency column. Every row written before it was
 * crystals, so the migration must keep every account, balance, ledger entry, id, idempotency key
 * and the ledger's id sequence, and only add {@code currency = 'crystals'}: no money is created or
 * lost.
 */
final class CurrencyMigrationTest {

  private static final List<String> BEFORE_CURRENCIES =
      List.of("V1__ledger.sql", "V2__player_names.sql", "V3__idempotent_transfers.sql");
  private static final Instant NOW = Instant.parse("2026-10-01T00:00:00Z");

  @TempDir Path directory;

  private StormDatabase database;

  @BeforeEach
  void openAtVersionThree() throws Exception {
    var migrations = directory.resolve("v3/db/migration/economy");
    Files.createDirectories(migrations);
    for (var name : BEFORE_CURRENCIES) {
      try (InputStream in =
          Objects.requireNonNull(
              CurrencyMigrationTest.class.getResourceAsStream("/db/migration/economy/" + name),
              name)) {
        Files.copy(in, migrations.resolve(name));
      }
    }
    database = StormDatabase.open(directory.resolve("t.db"));
    try (var v3 =
        new URLClassLoader(
            new java.net.URL[] {directory.resolve("v3").toUri().toURL()},
            ClassLoader.getPlatformClassLoader())) {
      database.migrate("economy", v3);
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

  private Record one(String query) throws Exception {
    return await(database.read(dsl -> dsl.fetchSingle(query)));
  }

  /** A V3 ledger with players, towns, a server sink, keyed transfers and a deleted top id. */
  private void seedVersionThree() throws Exception {
    var random = new SplittableRandom(4);
    for (var i = 0; i < 40; i++) {
      var player = new UUID(7, i).toString();
      var balance = random.nextLong(0, 5_000);
      sql(
          "INSERT INTO economy_account (kind, id, balance) VALUES ('player', ?, ?)",
          player,
          balance);
      if (i % 3 == 0) {
        sql(
            "INSERT INTO economy_ledger (from_kind, from_id, to_kind, to_id, amount, reason, at,"
                + " idempotency_key) VALUES ('server', 'server', 'player', ?, ?, 'seed', ?, ?)",
            player,
            balance + 1,
            1_000L + i,
            new UUID(9, i).toString());
      } else {
        sql(
            "INSERT INTO economy_ledger (from_kind, from_id, to_kind, to_id, amount, reason, at)"
                + " VALUES ('server', 'server', 'player', ?, ?, 'seed', ?)",
            player,
            balance + 1,
            1_000L + i);
      }
      sql(
          "INSERT INTO economy_ledger (from_kind, from_id, to_kind, to_id, amount, reason, at)"
              + " VALUES ('player', ?, 'server', 'server', 1, 'fee', ?)",
          player,
          2_000L + i);
    }
    for (var i = 0; i < 5; i++) {
      var town = new UUID(8, i).toString();
      sql(
          "INSERT INTO economy_account (kind, id, balance) VALUES ('town', ?, ?)",
          town,
          100L * (i + 1));
      sql(
          "INSERT INTO economy_ledger (from_kind, from_id, to_kind, to_id, amount, reason, at)"
              + " VALUES ('player', ?, 'town', ?, ?, 'town-deposit', ?)",
          new UUID(7, i).toString(),
          town,
          100L * (i + 1),
          3_000L + i);
    }
    // A transfer that was later rolled back by hand leaves the sequence above max(id).
    sql(
        "INSERT INTO economy_ledger (from_kind, from_id, to_kind, to_id, amount, reason, at)"
            + " VALUES ('server', 'server', 'player', ?, 1, 'rolled-back', 9999)",
        new UUID(7, 0).toString());
    sql("DELETE FROM economy_ledger WHERE reason = 'rolled-back'");
  }

  @Test
  void theMigrationKeepsEveryRowAndAmountAndOnlyAddsCrystals() throws Exception {
    seedVersionThree();
    var accountsBefore = rows("SELECT kind, id, balance FROM economy_account ORDER BY kind, id");
    var ledgerBefore =
        rows(
            "SELECT id, from_kind, from_id, to_kind, to_id, amount, reason, at, idempotency_key"
                + " FROM economy_ledger ORDER BY id");
    var totalsBefore =
        one(
            "SELECT (SELECT COUNT(*) FROM economy_account), (SELECT SUM(balance) FROM"
                + " economy_account), (SELECT COUNT(*) FROM economy_ledger), (SELECT SUM(amount)"
                + " FROM economy_ledger), (SELECT seq FROM sqlite_sequence WHERE name ="
                + " 'economy_ledger')");
    assertThat(accountsBefore).hasSize(45);
    assertThat(ledgerBefore).hasSize(85);

    database.migrate("economy", CurrencyMigrationTest.class.getClassLoader());

    assertThat(rows("SELECT kind, id, balance FROM economy_account ORDER BY kind, id"))
        .isEqualTo(accountsBefore);
    assertThat(
            rows(
                "SELECT id, from_kind, from_id, to_kind, to_id, amount, reason, at,"
                    + " idempotency_key FROM economy_ledger ORDER BY id"))
        .isEqualTo(ledgerBefore);
    var totalsAfter =
        one(
            "SELECT (SELECT COUNT(*) FROM economy_account), (SELECT SUM(balance) FROM"
                + " economy_account), (SELECT COUNT(*) FROM economy_ledger), (SELECT SUM(amount)"
                + " FROM economy_ledger), (SELECT seq FROM sqlite_sequence WHERE name ="
                + " 'economy_ledger')");
    assertThat(totalsAfter.intoArray()).containsExactly(totalsBefore.intoArray());
    assertThat(rows("SELECT DISTINCT currency FROM economy_account"))
        .containsExactly(List.of("crystals"));
    assertThat(rows("SELECT DISTINCT currency FROM economy_ledger"))
        .containsExactly(List.of("crystals"));
    assertThat(rows("SELECT name FROM sqlite_master WHERE name LIKE '%_v4'")).isEmpty();
  }

  @Test
  void theMigratedLedgerKeepsWorking() throws Exception {
    seedVersionThree();
    var lastId =
        Objects.requireNonNull(
            one("SELECT seq FROM sqlite_sequence WHERE name = 'economy_ledger'")
                .get(0, Long.class));
    database.migrate("economy", CurrencyMigrationTest.class.getClassLoader());
    var store = new JooqLedgerStore(database, InstantSource.fixed(NOW), TransferRules.standard());
    var alice = new AccountId.Player(new UUID(7, 0));
    var crystalsBefore = await(store.balance(alice, CurrencyId.CRYSTALS));

    var paid = await(store.transfer(new AccountId.Server(), alice, Money.rwfCredits(3), "rwf:win"));

    var receipt = ((Result.Ok<Receipt, EconomyError>) paid).value();
    assertThat(receipt.transactionId()).isEqualTo(lastId + 1);
    assertThat(await(store.balance(alice, CurrencyId.RWF_CREDITS))).isEqualTo(Money.rwfCredits(3));
    assertThat(await(store.balance(alice, CurrencyId.CRYSTALS))).isEqualTo(crystalsBefore);
    var keyed = await(store.receiptFor(new UUID(9, 0))).orElseThrow();
    assertThat(keyed.amount().currency()).isEqualTo(CurrencyId.CRYSTALS);
    assertThatThrownBy(
            () ->
                sql(
                    "INSERT INTO economy_ledger (from_kind, from_id, to_kind, to_id, currency,"
                        + " amount, reason, at, idempotency_key) VALUES ('server', 'server',"
                        + " 'player', ?, 'rwf_credits', 1, 'dupe', 1, ?)",
                    alice.uuid().toString(),
                    new UUID(9, 0).toString()))
        .isInstanceOf(ExecutionException.class)
        .hasMessageContaining("UNIQUE");
    assertThatThrownBy(
            () ->
                sql(
                    "INSERT INTO economy_account (kind, id, currency, balance)"
                        + " VALUES ('player', 'x', 'shards', 1)"))
        .isInstanceOf(ExecutionException.class)
        .hasMessageContaining("CHECK");
  }
}
