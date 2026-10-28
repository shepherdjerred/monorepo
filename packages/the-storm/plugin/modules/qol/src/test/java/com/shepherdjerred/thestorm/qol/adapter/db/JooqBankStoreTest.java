package com.shepherdjerred.thestorm.qol.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.domain.bank.BankRole;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.Spot;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.StoredShelf;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqBankStoreTest {

  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");

  @TempDir Path directory;
  StormDatabase database;
  JooqBankStore store;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("banks.db"));
    database.migrate("qol", JooqBankStoreTest.class.getClassLoader());
    store = new JooqBankStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void aBankAndItsShelfSurviveARestart() {
    var bank =
        new StoredBank(
            "bank-1",
            ALICE,
            new Spot("world", 1, 64, 2),
            new Spot("world", 1, 64, 3),
            Map.of(BOB, BankRole.ADD),
            List.of(
                new StoredShelf(
                    "shelf-1",
                    new Spot("world", 4, 64, 3),
                    new Spot("world", 4, 64, 4),
                    true,
                    Set.of("minecraft:stone"))));

    store.save(bank).join();
    database.close();
    database = StormDatabase.open(directory.resolve("banks.db"));
    database.migrate("qol", JooqBankStoreTest.class.getClassLoader());
    store = new JooqBankStore(database);

    assertThat(store.loadAll().join()).containsExactly(bank);
  }
}
