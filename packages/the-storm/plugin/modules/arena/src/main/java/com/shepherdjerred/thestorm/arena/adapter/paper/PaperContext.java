package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
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
  private final ComputePool compute;
  private final InstantSource time;
  private final RandomGenerator random;
  private final BlockChanges blocks;
  private final com.shepherdjerred.thestorm.core.analytics.GameActivity activity;
  private @Nullable ArenaPresence presence;

  PaperContext(ModuleContext module) {
    this.plugin = module.plugin();
    this.scheduler = module.scheduler();
    this.compute = module.compute();
    this.time = module.time();
    this.random = module.random();
    this.blocks = module.services().require(BlockChanges.class);
    this.activity =
        new com.shepherdjerred.thestorm.core.analytics.GameActivity(
            module.analytics(),
            com.shepherdjerred.thestorm.core.analytics.ProductAnalytics.Mode.ARENA);
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

  ComputePool compute() {
    return compute;
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

  BlockChanges blocks() {
    return blocks;
  }

  com.shepherdjerred.thestorm.core.analytics.GameActivity activity() {
    return activity;
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
                guarded(what, () -> then.accept(value));
              }
            },
            mainThread());
  }

  /**
   * Runs {@code work}, logging anything it throws. Future callbacks are otherwise silent: an
   * exception there would vanish with the discarded future.
   */
  void guarded(String what, Runnable work) {
    try {
      work.run();
    } catch (RuntimeException e) {
      logger().error("Unexpected failure while {}", what, e);
    }
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
