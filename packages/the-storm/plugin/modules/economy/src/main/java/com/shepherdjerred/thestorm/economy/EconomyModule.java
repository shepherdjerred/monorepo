package com.shepherdjerred.thestorm.economy;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.economy.adapter.db.JooqLedgerStore;
import com.shepherdjerred.thestorm.economy.adapter.paper.EconomyPaper;
import com.shepherdjerred.thestorm.economy.app.LedgerWallets;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.economy.domain.EconomyConfig;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;

/**
 * The crystal economy: balances, the transfer ledger, the starting balance and the money commands.
 * Publishes {@link Wallets} for other modules.
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
    EconomyPaper.install(context, wallets, config);
  }
}
