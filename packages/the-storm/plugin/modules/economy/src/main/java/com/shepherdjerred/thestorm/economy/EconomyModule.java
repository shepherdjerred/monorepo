package com.shepherdjerred.thestorm.economy;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.economy.adapter.db.JooqLedgerStore;
import com.shepherdjerred.thestorm.economy.adapter.paper.EconomyPaper;
import com.shepherdjerred.thestorm.economy.app.ConfiguredMoneyFormatter;
import com.shepherdjerred.thestorm.economy.app.LedgerWallets;
import com.shepherdjerred.thestorm.economy.app.MoneyFormatter;
import com.shepherdjerred.thestorm.economy.app.PlayerLeaderboard;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.economy.domain.EconomyConfig;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;

/**
 * The economy: balances in every currency, the transfer ledger, the starting balance and the money
 * commands. Publishes {@link Wallets}, {@link PlayerLeaderboard} and {@link MoneyFormatter} for
 * other modules.
 */
public final class EconomyModule implements StormModule {

  @Override
  public String id() {
    return "economy";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("economy.yml", EconomyConfig.class);
    context.database().migrate(id(), EconomyModule.class.getClassLoader());
    var store = new JooqLedgerStore(context.database(), context.time(), TransferRules.standard());
    var wallets = new LedgerWallets(store, config.startingCrystals());
    context.services().provide(Wallets.class, wallets);
    context.services().provide(PlayerLeaderboard.class, wallets::leaderboard);
    context.services().provide(MoneyFormatter.class, new ConfiguredMoneyFormatter(config.format()));
    EconomyPaper.install(context, wallets, config);
  }
}
