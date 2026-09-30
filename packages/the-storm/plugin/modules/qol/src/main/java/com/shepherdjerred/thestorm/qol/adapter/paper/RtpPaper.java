package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.qol.app.LandingMemory;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.List;
import org.bukkit.event.Listener;

/** Wires random teleport and first-arrival dialog alongside the other QoL features. */
public final class RtpPaper {

  private RtpPaper() {}

  public static void install(ModuleContext context, QolStore store, QolConfig config) {
    var worlds = context.services().require(WildWorlds.class);
    var flow =
        new RtpFlow(
            new RtpFlow.Ports(
                worlds,
                context.services().require(SettledLand.class),
                store,
                context.services().require(Wallets.class)),
            context,
            config,
            new LandingMemory(config.landingMemoryDuration()));
    var dialog = new ArrivalDialog(config, worlds, flow);
    var commands = new RtpCommands(flow, worlds, config);
    var plugin = context.plugin();
    List<Listener> listeners =
        List.of(new JoinListener(store, dialog, context, flow), new TravelListener(flow));
    for (var listener : listeners) {
      plugin.getServer().getPluginManager().registerEvents(listener, plugin);
    }
    flow.recoverPending();
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }
}
