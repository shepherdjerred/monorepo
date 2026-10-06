package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.essentials.app.StaffState;
import com.shepherdjerred.thestorm.essentials.app.TpaDesk;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import java.util.List;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/** Wires the administrative surface independently from existing player commands. */
final class StaffPaper {
  private final StaffCommands commands;
  private final List<Listener> listeners;
  private final Cancellable sweep;

  StaffPaper(ModuleContext context, StaffState state, EssentialsPaper.App app, TpaDesk tpa) {
    commands = new StaffCommands(context, state, app);
    var visibility = new StaffVisibility(commands);
    visibility.register();
    var inventories = new StaffInventories(commands);
    inventories.register();
    var entities = new StaffEntities(commands);
    entities.register();
    var jails = new StaffJails(commands);
    jails.register();
    var ip = new StaffIp(commands);
    ip.register();
    new StaffTravel(commands, app, tpa).register();
    new StaffAdministration(commands).register();
    new StaffEffects(commands).register();
    listeners = List.of(visibility, inventories, entities, jails, ip.clients);
    listeners.forEach(
        listener ->
            context
                .plugin()
                .getServer()
                .getPluginManager()
                .registerEvents(listener, context.plugin()));
    sweep =
        context
            .scheduler()
            .repeatOnMainThread(
                Duration.ofSeconds(5),
                Duration.ofSeconds(5),
                () -> {
                  if (state.ready()) {
                    visibility.sweep();
                    jails.sweep();
                  }
                });
    var _ =
        state
            .loaded()
            .whenCompleteAsync(
                (done, failure) -> {
                  if (failure != null) {
                    context.logger().error("Staff state could not load; stopping server", failure);
                    context.plugin().getServer().shutdown();
                    return;
                  }
                  for (var id : state.keys("session"))
                    PlayerVisibility.restore(
                        java.util.UUID.fromString(id),
                        state
                            .find("session", id, StaffState.Session.class)
                            .orElseThrow()
                            .vanished());
                  PlayerVisibility.markRestored();
                  context
                      .plugin()
                      .getServer()
                      .getOnlinePlayers()
                      .forEach(org.bukkit.entity.Player::updateCommands);
                },
                context.scheduler().mainThread());
  }

  void register(Commands registrar) {
    commands.register(registrar);
    new StaffGuide(commands).register(registrar);
  }

  void stop() {
    sweep.cancel();
    listeners.forEach(HandlerList::unregisterAll);
    commands.stop();
  }
}
