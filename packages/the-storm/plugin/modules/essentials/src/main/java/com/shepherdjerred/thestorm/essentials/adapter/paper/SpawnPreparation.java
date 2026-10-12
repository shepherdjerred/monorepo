package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.essentials.domain.config.EssentialsConfig;
import java.util.concurrent.atomic.AtomicBoolean;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

/** Loads the configured spawn without blocking Paper, keeping logins closed until it is safe. */
final class SpawnPreparation implements Listener {

  private final AtomicBoolean ready = new AtomicBoolean();

  static SpawnPreparation start(ModuleContext context, EssentialsConfig config) {
    return start(context, config, context.plugin().getServer()::shutdown);
  }

  static SpawnPreparation start(
      ModuleContext context, EssentialsConfig config, Runnable stopServer) {
    var preparation = new SpawnPreparation();
    var server = context.plugin().getServer();
    var spawn = config.spawn();
    var at =
        Positions.toLocation(server, spawn)
            .orElseThrow(
                () -> new IllegalStateException("essentials.yml spawn world is not loaded"));
    if (at.getWorld().isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4)) {
      validate(config, at);
      preparation.ready.set(true);
      return preparation;
    }
    var _ =
        at.getWorld()
            .getChunkAtAsync(at.getBlockX() >> 4, at.getBlockZ() >> 4, false, true)
            .whenComplete(
                (chunk, failure) ->
                    context
                        .scheduler()
                        .runOnMainThread(
                            () -> {
                              if (!context.plugin().isEnabled()) {
                                return;
                              }
                              try {
                                if (failure != null || chunk == null) {
                                  throw new IllegalStateException(
                                      "Could not load the existing configured spawn chunk",
                                      failure);
                                }
                                validate(config, at);
                                preparation.ready.set(true);
                                context
                                    .logger()
                                    .info("essentials spawn ready at {}", spawn.describe());
                              } catch (RuntimeException problem) {
                                context
                                    .logger()
                                    .error(
                                        "Spawn preparation failed; stopping the server", problem);
                                stopServer.run();
                              }
                            }));
    return preparation;
  }

  private static void validate(EssentialsConfig config, org.bukkit.Location at) {
    if (!SafeLocations.isSafe(at)) {
      throw new IllegalStateException(
          "essentials.yml spawn at "
              + config.spawn().describe()
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
