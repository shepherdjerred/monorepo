package com.shepherdjerred.thestorm.economy.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.adapter.db.JooqLedgerStore;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class LedgerWalletsTest {

  private static final AccountId.Player ALICE = new AccountId.Player(new UUID(0, 1));
  private static final AccountId.Player BOB = new AccountId.Player(new UUID(0, 2));

  @TempDir Path directory;

  private StormDatabase database;
  private LedgerWallets wallets;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("economy", LedgerWalletsTest.class.getClassLoader());
    var store =
        new JooqLedgerStore(database, InstantSource.fixed(Instant.EPOCH), TransferRules.standard());
    wallets = new LedgerWallets(store, Crystals.of(500));
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void welcomePaysTheConfiguredStartingBalanceOnce() throws Exception {
    var first = wallets.welcome(ALICE.uuid()).get(10, TimeUnit.SECONDS);
    var again = wallets.welcome(ALICE.uuid()).get(10, TimeUnit.SECONDS);

    assertThat(first.orElseThrow().reason()).isEqualTo(LedgerWallets.STARTING_BALANCE_REASON);
    assertThat(first.orElseThrow().amount()).isEqualTo(Crystals.of(500));
    assertThat(again).isEmpty();
    assertThat(wallets.balance(ALICE).get(10, TimeUnit.SECONDS)).isEqualTo(Crystals.of(500));
  }

  @Test
  void startingBalancesAreSpendable() throws Exception {
    wallets.welcome(ALICE.uuid()).get(10, TimeUnit.SECONDS);

    var paid = wallets.transfer(ALICE, BOB, Crystals.of(125), "pay").get(10, TimeUnit.SECONDS);

    assertThat(paid.isOk()).isTrue();
    assertThat(wallets.top(10).get(10, TimeUnit.SECONDS))
        .containsExactly(
            new Wallets.Standing(ALICE, Crystals.of(375)),
            new Wallets.Standing(BOB, Crystals.of(125)));
  }

  @Test
  void everyTransferNeedsAReason() {
    assertThatThrownBy(() -> wallets.transfer(ALICE, BOB, Crystals.of(1), " "))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> wallets.setBalance(ALICE, Crystals.of(1), ""))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void topNeedsAPositiveLimit() {
    assertThatThrownBy(() -> wallets.top(0)).isInstanceOf(IllegalArgumentException.class);
  }
}
