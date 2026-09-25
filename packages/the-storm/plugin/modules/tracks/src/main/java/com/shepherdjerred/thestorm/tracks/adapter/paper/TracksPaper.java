package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.tracks.domain.Explanations;
import com.shepherdjerred.thestorm.tracks.domain.TracksConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.Server;

/**
 * Hooks the tracks into Paper: the join and quit listener and {@code /perks}. Requires the
 * economy's {@link CrystalFormatter} and core's {@link PlayerDirectory} from the services.
 */
public final class TracksPaper {

  private TracksPaper() {}

  /** Tells {@code player}, if online, that their tracks could not be loaded. Main thread. */
  public static Consumer<UUID> loadFailedNotice(Server server) {
    return player -> {
      var online = server.getPlayer(player);
      if (online != null) {
        online.sendMessage(Replies.error(Explanations.LOAD_FAILED));
      }
    };
  }

  public static void install(ModuleContext context, TracksConfig config, UseCases useCases) {
    var server = context.plugin().getServer();
    var formatter = context.services().require(CrystalFormatter.class);
    var replies = new Replies(context.scheduler().mainThread(), context.logger());
    var explanations = new Explanations(config, amount -> formatter.words(Crystals.of(amount)));
    var presenter = new Presenter(config, explanations);
    var paper =
        new Paper(
            server,
            context.services().require(PlayerDirectory.class),
            replies,
            context.time(),
            config.confirmWindow());
    var commands = new PerksCommands(useCases, presenter, paper);
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
