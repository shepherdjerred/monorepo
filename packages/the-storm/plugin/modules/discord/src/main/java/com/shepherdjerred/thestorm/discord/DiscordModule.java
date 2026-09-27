package com.shepherdjerred.thestorm.discord;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.discord.adapter.discord.JdaGateway;
import com.shepherdjerred.thestorm.discord.adapter.paper.DiscordPaperListener;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import org.jspecify.annotations.Nullable;

/** Bridges the server's global chat and activity to one Discord channel. */
public final class DiscordModule implements StormModule {

  private @Nullable JdaGateway gateway;

  @Override
  public String id() {
    return "discord";
  }

  @Override
  public void enable(ModuleContext context) {
    var bootstrap = DiscordBootstrap.fromEnvironment(System.getenv());
    var bridge =
        new JdaGateway(
            context,
            bootstrap,
            new JdaGateway.ReadPorts(
                context.services().require(Wallets.class),
                context.services().require(CrystalFormatter.class),
                context.services().require(TownRead.class)));
    context
        .plugin()
        .getServer()
        .getPluginManager()
        .registerEvents(new DiscordPaperListener(bridge), context.plugin());
    bridge.start();
    gateway = bridge;
    context.logger().info("Discord bridge enabled");
  }

  @Override
  public void disable() {
    var bridge = gateway;
    if (bridge != null) {
      bridge.close();
      gateway = null;
    }
  }
}
