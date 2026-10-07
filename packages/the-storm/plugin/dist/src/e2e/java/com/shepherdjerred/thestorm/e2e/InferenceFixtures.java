package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.DiagnosticInference;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import tools.jackson.databind.json.JsonMapper;

/** Disposable console-only ONNX model diagnostics. Never part of the production jar. */
final class InferenceFixtures implements BasicCommand {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final JavaPlugin plugin;
  private final DuelFixtures duels;
  private Optional<CompletableFuture<BatchedInference>> loading = Optional.empty();
  private boolean ready;

  InferenceFixtures(JavaPlugin plugin, DuelFixtures duels) {
    this.plugin = plugin;
    this.duels = duels;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> event.registrar().register("rwfinfer", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender
        || source.getSender() instanceof RemoteConsoleCommandSender)) {
      source
          .getSender()
          .sendMessage(Component.text("rwfinfer requires the disposable server console"));
      return;
    }
    try {
      source.getSender().sendMessage(Component.text(JSON.writeValueAsString(command(args))));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      source
          .getSender()
          .sendMessage(
              Component.text(JSON.writeValueAsString(Map.of("error", failure.getMessage()))));
    }
  }

  private Map<String, Object> command(String[] args) {
    if (args.length == 0)
      throw new IllegalArgumentException(
          "rwfinfer load, state, begin <seed> <side> <opponent>, metrics");
    switch (args[0]) {
      case "load" -> load(args);
      case "state" -> {
        if (args.length != 1) throw new IllegalArgumentException("state has no arguments");
      }
      case "begin" -> {
        if (args.length != 4 || !ready)
          throw new IllegalArgumentException("begin needs a ready model, seed, side and opponent");
        duels.beginJava(Long.parseLong(args[1]), args[2], args[3]);
      }
      case "metrics" -> {
        if (args.length != 1) throw new IllegalArgumentException("metrics has no arguments");
        return Map.of("metrics", duels.inferenceMetrics());
      }
      default -> throw new IllegalArgumentException("unknown rwfinfer command");
    }
    return state();
  }

  private Map<String, Object> state() {
    var future = loading;
    if (!ready && future.isPresent() && future.orElseThrow().isDone()) {
      try {
        var model = future.orElseThrow().getNow(null);
        if (model == null) throw new IllegalStateException("missing loaded Java actor");
        duels.inference(model);
        ready = true;
      } catch (java.util.concurrent.CompletionException failure) {
        throw new IllegalStateException("diagnostic actor loading failed", failure);
      }
    }
    return Map.of("state", ready ? "ready" : loading.isPresent() ? "loading" : "empty");
  }

  private void load(String[] args) {
    if (args.length != 1 || loading.isPresent())
      throw new IllegalArgumentException("diagnostic model can load once per fixture server");
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    loading = Optional.of(storm.service(DiagnosticInference.class).load());
  }
}
