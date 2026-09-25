package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.tracks.domain.Explanations;
import com.shepherdjerred.thestorm.tracks.domain.TracksConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;

/** Hooks the tracks into Paper: the join and quit listener and {@code /perks}. */
public final class TracksPaper {

  private TracksPaper() {}

  public static void install(ModuleContext context, TracksConfig config, UseCases useCases) {
    var server = context.plugin().getServer();
    var replies = new Replies(context.scheduler().mainThread(), context.logger());
    var presenter = new Presenter(config, new Explanations(config));
    var commands =
        new PerksCommands(
            useCases,
            presenter,
            new Paper(server, replies, context.time(), config.confirmWindow()));
    server
        .getPluginManager()
        .registerEvents(new SessionListener(useCases.sessions(), commands), context.plugin());
    // Players already online (a plugin reload) never fire a join event.
    for (var player : server.getOnlinePlayers()) {
      useCases.sessions().joined(player.getUniqueId());
    }
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }
}
