package com.shepherdjerred.thestorm.core.schedule;

import java.time.Duration;
import java.util.concurrent.Executor;
import org.bukkit.plugin.Plugin;

/** The {@link Scheduler} backed by Paper's main-thread scheduler. */
public final class PaperScheduler implements Scheduler {

  private static final long MILLIS_PER_TICK = 50;

  private final Plugin plugin;

  public PaperScheduler(Plugin plugin) {
    this.plugin = plugin;
  }

  @Override
  public void runOnMainThread(Runnable task) {
    plugin.getServer().getScheduler().runTask(plugin, task);
  }

  @Override
  public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
    var handle = plugin.getServer().getScheduler().runTaskLater(plugin, task, ticks(delay));
    return handle::cancel;
  }

  @Override
  public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
    var handle =
        plugin
            .getServer()
            .getScheduler()
            .runTaskTimer(plugin, task, ticks(delay), Math.max(1, ticks(period)));
    return handle::cancel;
  }

  @Override
  public Executor mainThread() {
    return this::runOnMainThread;
  }

  static long ticks(Duration duration) {
    if (duration.isNegative()) {
      throw new IllegalArgumentException("duration must not be negative: " + duration);
    }
    return duration.toMillis() / MILLIS_PER_TICK;
  }
}
