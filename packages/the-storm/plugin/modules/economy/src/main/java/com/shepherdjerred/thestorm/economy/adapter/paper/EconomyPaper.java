package com.shepherdjerred.thestorm.economy.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.economy.app.LedgerWallets;
import com.shepherdjerred.thestorm.economy.domain.CrystalFormat;
import com.shepherdjerred.thestorm.economy.domain.EconomyConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;

/** Hooks the economy into Paper: the first-join listener and the Brigadier commands. */
public final class EconomyPaper {

  private EconomyPaper() {}

  public static void install(ModuleContext context, LedgerWallets wallets, EconomyConfig config) {
    var server = context.plugin().getServer();
    var replies = new Replies(context.scheduler(), context.logger());
    var format = new CrystalFormat(config.currency());
    server
        .getPluginManager()
        .registerEvents(new FirstJoinListener(wallets, format, server, replies), context.plugin());
    var commands =
        new EconomyCommands(
            wallets, format, config.baltopSize(), new EconomyCommands.Paper(server, replies));
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }
}
