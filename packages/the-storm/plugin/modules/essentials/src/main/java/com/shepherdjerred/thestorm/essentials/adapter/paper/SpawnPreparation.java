package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.essentials.domain.config.EssentialsConfig;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

/** Loads the configured spawn without blocking Paper, keeping logins closed until it is safe. */
final class SpawnPreparation implements Listener {

  private final AtomicBoolean ready = new AtomicBoolean();
  private final AtomicInteger pending = new AtomicInteger(2);
  private final ModuleContext context;
  private final Runnable stopServer;

  private SpawnPreparation(ModuleContext context, Runnable stopServer) {
    this.context = context;
    this.stopServer = stopServer;
  }

  static SpawnPreparation start(ModuleContext context, EssentialsConfig config) {
    return start(context, config, context.plugin().getServer()::shutdown);
  }

  static SpawnPreparation start(
      ModuleContext context, EssentialsConfig config, Runnable stopServer) {
    var preparation = new SpawnPreparation(context, stopServer);
    var server = context.plugin().getServer();
    for (var spawn : java.util.List.of(config.spawn(), config.newcomerSpawn())) {
      var at =
          Positions.toLocation(server, spawn)
              .orElseThrow(
                  () -> new IllegalStateException("essentials.yml spawn world is not loaded"));
      if (at.getWorld().isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4)) {
        validate(at);
        preparation.markPrepared();
        continue;
      }
      var _ =
          at.getWorld()
              .getChunkAtAsync(at.getBlockX() >> 4, at.getBlockZ() >> 4, true, true)
              .whenComplete(
                  (chunk, failure) ->
                      context
                          .scheduler()
                          .runOnMainThread(
                              () -> preparation.finishLoad(spawn, at, failure, chunk == null)));
    }
    return preparation;
  }

  private void markPrepared() {
    if (pending.decrementAndGet() == 0) ready.set(true);
  }

  /** Runs on the main thread once one spawn chunk finished loading, or failed to. */
  private void finishLoad(
      Position spawn, org.bukkit.Location at, Throwable failure, boolean missing) {
    if (!context.plugin().isEnabled()) {
      return;
    }
    try {
      if (failure != null || missing) {
        throw new IllegalStateException(
            "Could not load the existing configured spawn chunk", failure);
      }
      validate(at);
      markPrepared();
      context.logger().info("essentials spawn ready at {}", spawn.describe());
    } catch (RuntimeException problem) {
      context.logger().error("Spawn preparation failed; stopping the server", problem);
      stopServer.run();
    }
  }

  private static void validate(org.bukkit.Location at) {
    if (!SafeLocations.isSafe(at)) {
      throw new IllegalStateException(
          "essentials.yml spawn at "
              + at
              + " is not safe: it needs a solid block underfoot and two open blocks above it,"
              + " with no lava, fire or other hazards");
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void onLogin(AsyncPlayerPreLoginEvent event) {
    if (!ready.get()) {
      event.disallow(
          AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
          net.kyori.adventure.text.Component.text(
              "The Storm is preparing spawn. Please reconnect shortly."));
    }
  }
}
