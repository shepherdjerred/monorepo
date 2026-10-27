package com.shepherdjerred.thestorm.economy.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.SeenPlayer;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqLedgerResetTest {

  @Test
  void resetRestoresTheStartingBalanceEligibility(@TempDir Path directory) throws Exception {
    try (var database = StormDatabase.open(directory.resolve("economy.db"))) {
      database.migrate("economy", getClass().getClassLoader());
      var store = new JooqLedgerStore(database, InstantSource.system(), TransferRules.standard());
      var player = UUID.randomUUID();
      var seen = new SeenPlayer(player, "Player");
      var account = new AccountId.Player(player);
      await(store.welcome(seen, Money.crystals(100), "start"));
      assertThat(await(store.balance(account, CurrencyId.CRYSTALS)).amount()).isEqualTo(100);

      await(store.reset(player));

      assertThat(await(store.balance(account, CurrencyId.CRYSTALS)).amount()).isZero();
      assertThat(await(store.welcome(seen, Money.crystals(100), "start"))).isPresent();
      assertThat(await(store.balance(account, CurrencyId.CRYSTALS)).amount()).isEqualTo(100);
    }
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
