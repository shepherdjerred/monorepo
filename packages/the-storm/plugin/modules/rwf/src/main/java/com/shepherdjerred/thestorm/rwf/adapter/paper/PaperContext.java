package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
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
  private final World world;

  /**
   * What the context is made of.
   *
   * @param plugin the owning plugin
   * @param scheduler main-thread scheduling
   * @param compute off-main-thread CPU work
   * @param time the clock
   * @param random randomness for map choice
   * @param world the sealed world matches run in
   */
  record Parts(
      Plugin plugin,
      Scheduler scheduler,
      ComputePool compute,
      InstantSource time,
      RandomGenerator random,
      World world) {}

  PaperContext(Parts parts) {
    this.plugin = parts.plugin();
    this.scheduler = parts.scheduler();
    this.compute = parts.compute();
    this.time = parts.time();
    this.random = parts.random();
    this.world = parts.world();
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

  /** The sealed world matches run in. */
  World world() {
    return world;
  }

  ComponentLogger logger() {
    return plugin.getComponentLogger();
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
