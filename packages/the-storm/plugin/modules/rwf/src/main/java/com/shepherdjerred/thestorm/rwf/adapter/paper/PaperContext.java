package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import java.time.InstantSource;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.plugin.Plugin;

/** The server-facing services every rwf adapter shares. Main thread only. */
final class PaperContext {

  private final Plugin plugin;
  private final Scheduler scheduler;
  private final ComputePool compute;
  private final InstantSource time;
  private final RandomGenerator random;
  private final World lobbyWorld;
  private final World mapWorld;
  private final BlockChanges blocks;
  private final com.shepherdjerred.thestorm.core.analytics.GameActivity activity;
  private final com.shepherdjerred.thestorm.core.analytics.ProductAnalytics analytics;

  /**
   * What the context is made of.
   *
   * @param plugin the owning plugin
   * @param scheduler main-thread scheduling
   * @param compute off-main-thread CPU work
   * @param time the clock
   * @param random randomness for map choice
   * @param lobbyWorld the sealed world the lobby stands in
   * @param mapWorld the sealed world the maps stand in
   */
  record Parts(
      Plugin plugin,
      Scheduler scheduler,
      ComputePool compute,
      InstantSource time,
      RandomGenerator random,
      World lobbyWorld,
      World mapWorld,
      BlockChanges blocks,
      com.shepherdjerred.thestorm.core.analytics.ProductAnalytics analytics) {}

  PaperContext(Parts parts) {
    this.plugin = parts.plugin();
    this.scheduler = parts.scheduler();
    this.compute = parts.compute();
    this.time = parts.time();
    this.random = parts.random();
    this.lobbyWorld = parts.lobbyWorld();
    this.mapWorld = parts.mapWorld();
    this.blocks = parts.blocks();
    this.analytics = parts.analytics();
    this.activity =
        new com.shepherdjerred.thestorm.core.analytics.GameActivity(
            parts.analytics(),
            com.shepherdjerred.thestorm.core.analytics.ProductAnalytics.Mode.SEARCH_AND_DESTROY);
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

  /** The sealed world the lobby stands in. */
  World lobbyWorld() {
    return lobbyWorld;
  }

  /** The sealed world the maps stand in, where matches are fought and watched. */
  World mapWorld() {
    return mapWorld;
  }

  /** Whether {@code world} is one of the two sealed rwf worlds. */
  boolean ours(World world) {
    return world.equals(lobbyWorld) || world.equals(mapWorld);
  }

  BlockChanges blocks() {
    return blocks;
  }

  com.shepherdjerred.thestorm.core.analytics.GameActivity activity() {
    return activity;
  }

  /** Product analytics, for the module's named game events. */
  com.shepherdjerred.thestorm.core.analytics.ProductAnalytics analytics() {
    return analytics;
  }

  ComponentLogger logger() {
    return plugin.getComponentLogger();
  }

  /**
   * As {@link #onMain(CompletableFuture, Consumer, String)}, and on failure, after logging it, runs
   * {@code otherwise} on the main thread so the caller can undo what waited on the result.
   */
  <T> void onMain(CompletableFuture<T> future, Consumer<T> then, Runnable otherwise, String what) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                logger().error("Could not {}", what, failure);
                guarded(what, otherwise);
              } else {
                guarded(what, () -> then.accept(value));
              }
            },
            mainThread());
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
