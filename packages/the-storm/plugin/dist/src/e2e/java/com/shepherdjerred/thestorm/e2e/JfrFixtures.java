package com.shepherdjerred.thestorm.e2e;

import com.google.gson.Gson;
import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/** Private RCON adapter. Match access and activation validation stay on the server thread. */
final class JfrFixtures implements BasicCommand, AutoCloseable {
  private static final Gson JSON = new Gson();
  private final JavaPlugin plugin;
  private final DiagnosticJfr recording;
  private BukkitTask monitor;
  private boolean closed;

  JfrFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
    recording =
        new DiagnosticJfr(
            plugin.getDataFolder().toPath().resolve("jfr"), plugin.getServer().getClass());
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-jfr", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof RemoteConsoleCommandSender))
      throw new IllegalStateException("JFR diagnostic requires the private RCON console");
    try {
      if (closed) throw new IllegalStateException("JFR fixtures disabled");
      if (args.length != 3)
        throw new IllegalArgumentException(
            "use start|status|stop <live-match-uuid> <attempt-uuid>");
      var binding = new DiagnosticJfr.Binding(UUID.fromString(args[1]), UUID.fromString(args[2]));
      switch (args[0]) {
        case "start" -> start(binding);
        case "status" -> refresh();
        case "stop" -> {
          refresh();
          recording.stop(binding);
        }
        default -> throw new IllegalArgumentException("unknown JFR diagnostic command");
      }
      source.getSender().sendMessage(Component.text(JSON.toJson(recording.status(binding))));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      source
          .getSender()
          .sendMessage(Component.text(JSON.toJson(Map.of("error", failure.getMessage()))));
    }
  }

  private void start(DiagnosticJfr.Binding binding) {
    if (current()
        .filter(match -> match.matchId().equals(binding.match()))
        .filter(match -> match.phase() == MatchSnapshot.PhaseKind.LIVE)
        .isEmpty())
      throw new IllegalStateException("JFR diagnostic requires the exact current Live match");
    recording.start(binding);
    monitor = plugin.getServer().getScheduler().runTaskTimer(plugin, this::refresh, 1, 1);
  }

  private Optional<MatchSnapshot> current() {
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    return storm.service(MatchView.class).current();
  }

  private void refresh() {
    if (recording.observing()) {
      current()
          .ifPresentOrElse(
              match ->
                  recording.observeLive(
                      match.matchId(), match.phase() == MatchSnapshot.PhaseKind.LIVE),
              recording::noLiveMatch);
    }
    if (!recording.status().workerAlive() && monitor != null) monitor.cancel();
  }

  /** Signals only; an unfinished worker cannot be synchronously awaited during plugin disable. */
  @Override
  public void close() {
    closed = true;
    if (monitor != null) monitor.cancel();
    recording.close();
    if (recording.status().workerAlive())
      plugin.getLogger().warning("JFR diagnostic incomplete: asynchronous cleanup requested");
  }
}
