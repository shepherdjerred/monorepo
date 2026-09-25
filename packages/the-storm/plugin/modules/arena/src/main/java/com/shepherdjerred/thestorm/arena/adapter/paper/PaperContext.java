package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.InstantSource;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;

/** The server-facing services every arena adapter shares. Main thread only. */
final class PaperContext {

  private final Plugin plugin;
  private final Scheduler scheduler;
  private final InstantSource time;
  private final RandomGenerator random;
  private @Nullable ArenaPresence presence;

  PaperContext(Plugin plugin, Scheduler scheduler, InstantSource time, RandomGenerator random) {
    this.plugin = plugin;
    this.scheduler = scheduler;
    this.time = time;
    this.random = random;
  }

  Plugin plugin() {
    return plugin;
  }

  Server server() {
    return plugin.getServer();
  }

  Scheduler scheduler() {
    return scheduler;
  }

  Executor mainThread() {
    return scheduler.mainThread();
  }

  InstantSource time() {
    return time;
  }

  RandomGenerator random() {
    return random;
  }

  ComponentLogger logger() {
    return plugin.getComponentLogger();
  }

  /** Connects who-is-in-an-arena, which the arenas provide once they exist. */
  void presence(ArenaPresence arenas) {
    if (presence != null) {
      throw new IllegalStateException("arena presence is already connected");
    }
    presence = arenas;
  }

  boolean inArena(UUID player) {
    if (presence == null) {
      throw new IllegalStateException("arena presence is not connected yet");
    }
    return presence.arenaOf(player).isPresent();
  }

  /** Runs {@code then} on the main thread with the result, or logs why {@code what} failed. */
  <T> void onMain(CompletableFuture<T> future, Consumer<T> then, String what) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                logger().error("Could not {}", what, failure);
              } else {
                then.accept(value);
              }
            },
            mainThread());
  }

  /** Logs if {@code future} fails. */
  void logFailure(CompletableFuture<?> future, String what) {
    var _ =
        future.whenComplete(
            (value, failure) -> {
              if (failure != null) {
                logger().error("Could not {}", what, failure);
              }
            });
  }
}
