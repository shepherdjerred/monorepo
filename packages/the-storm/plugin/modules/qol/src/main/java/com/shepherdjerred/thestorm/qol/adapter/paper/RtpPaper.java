package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
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
    var recovered = LegacyRtpRecovery.start(store, context.services().require(Wallets.class));
    var _ =
        recovered.whenComplete(
            (done, failure) -> {
              if (failure != null) {
                context
                    .logger()
                    .error(
                        "Could not reconcile legacy RTP charges; travel is unavailable", failure);
              }
            });
    context
        .services()
        .require(TeleportTravel.class)
        .configureRtp(
            player ->
                store
                    .ensure(player, context.time().instant())
                    .thenApply(ensured -> ensured.profile().firstSeen()),
            recovered);
    var worlds = context.services().require(WildWorlds.class);
    var flow =
        new RtpFlow(
            new RtpFlow.Ports(worlds, context.services().require(SettledLand.class), store),
            context,
            config,
            new LandingMemory(config.landingMemoryDuration()));
    var dialog =
        new ArrivalDialog(
            config, worlds, flow, context.services().require(TeleportTravel.class).policy());
    var commands = new RtpCommands(flow, worlds, config);
    var plugin = context.plugin();
    List<Listener> listeners = List.of(new JoinListener(store, dialog, context));
    for (var listener : listeners) {
      plugin.getServer().getPluginManager().registerEvents(listener, plugin);
    }
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }
}
