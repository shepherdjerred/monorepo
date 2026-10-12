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
    wallets = new LedgerWallets(store, Money.crystals(500));
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void welcomePaysTheConfiguredStartingBalanceOnce() throws Exception {
    var first = wallets.welcome(new SeenPlayer(ALICE.uuid(), "Alice")).get(10, TimeUnit.SECONDS);
    var again = wallets.welcome(new SeenPlayer(ALICE.uuid(), "Alice")).get(10, TimeUnit.SECONDS);

    assertThat(first.orElseThrow().reason()).isEqualTo(LedgerWallets.STARTING_BALANCE_REASON);
    assertThat(first.orElseThrow().amount()).isEqualTo(Money.crystals(500));
    assertThat(again).isEmpty();
    assertThat(wallets.balance(ALICE, CurrencyId.CRYSTALS).get(10, TimeUnit.SECONDS))
        .isEqualTo(Money.crystals(500));
  }

  @Test
  void startingBalancesAreSpendable() throws Exception {
    wallets.welcome(new SeenPlayer(ALICE.uuid(), "Alice")).get(10, TimeUnit.SECONDS);

    var paid = wallets.transfer(ALICE, BOB, Money.crystals(125), "pay").get(10, TimeUnit.SECONDS);

    assertThat(paid.isOk()).isTrue();
    assertThat(wallets.top(CurrencyId.CRYSTALS, 10).get(10, TimeUnit.SECONDS))
        .containsExactly(
            new Wallets.Standing(ALICE, Money.crystals(375)),
            new Wallets.Standing(BOB, Money.crystals(125)));
  }

  @Test
  void balancesListEveryCurrencyInOrder() throws Exception {
    wallets.welcome(new SeenPlayer(ALICE.uuid(), "Alice")).get(10, TimeUnit.SECONDS);
    wallets
        .transfer(new AccountId.Server(), ALICE, Money.rwfCredits(3), "rwf")
        .get(10, TimeUnit.SECONDS);

    var balances = wallets.balances(ALICE).get(10, TimeUnit.SECONDS);
    assertThat(balances.keySet()).containsExactly(CurrencyId.values());
    assertThat(balances)
        .containsEntry(CurrencyId.CRYSTALS, Money.crystals(500))
        .containsEntry(CurrencyId.RWF_CREDITS, Money.rwfCredits(3));
    assertThat(wallets.balances(BOB).get(10, TimeUnit.SECONDS))
        .containsEntry(CurrencyId.CRYSTALS, Money.crystals(0))
        .containsEntry(CurrencyId.RWF_CREDITS, Money.rwfCredits(0));
  }

  @Test
  void everyTransferNeedsAReason() {
    assertThatThrownBy(() -> wallets.transfer(ALICE, BOB, Money.crystals(1), " "))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> wallets.setBalance(ALICE, Money.crystals(1), ""))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void topNeedsAPositiveLimit() {
    assertThatThrownBy(() -> wallets.top(CurrencyId.CRYSTALS, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
