package com.shepherdjerred.thestorm.tickets;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.tickets.adapter.db.JooqTicketStore;
import com.shepherdjerred.thestorm.tickets.adapter.discord.TicketDiscordPosts;
import com.shepherdjerred.thestorm.tickets.adapter.paper.TicketCommands;
import com.shepherdjerred.thestorm.tickets.adapter.paper.TicketRuntime;
import com.shepherdjerred.thestorm.tickets.app.TicketConfig;
import com.shepherdjerred.thestorm.tickets.app.TicketEvent;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.Optional;
import java.util.function.Consumer;

/**
 * Player report tickets and the staff queue. Publishes {@link TicketService} for the agent module
 * and staff tooling. Ticket changes reach Discord when that module is on, and stay in-game when it
 * is off.
 */
public final class TicketsModule implements StormModule {

  @Override
  public String id() {
    return "tickets";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("tickets.yml", TicketConfig.class);
    context.database().migrate(id(), getClass().getClassLoader());

    var players = context.services().require(PlayerDirectory.class);
    var service =
        new TicketService(
            new JooqTicketStore(context.database(), config.serverId()), context.time());
    posts(context, players).ifPresent(service::addListener);
    var runtime =
        new TicketRuntime(context.plugin().getServer(), context.scheduler(), context.logger());
    var commands = new TicketCommands(service, players, config, runtime);
    context.services().provide(TicketService.class, service);

    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }

  private Optional<Consumer<TicketEvent>> posts(ModuleContext context, PlayerDirectory players) {
    return context
        .services()
        .find(DiscordRelay.class)
        .map(relay -> new TicketDiscordPosts(relay, players, context.logger()))
        .map(posts -> (Consumer<TicketEvent>) posts::post);
  }
}
