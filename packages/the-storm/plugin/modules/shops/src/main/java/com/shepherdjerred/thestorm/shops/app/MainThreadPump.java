package com.shepherdjerred.thestorm.shops.app;

import java.time.Duration;
import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

/**
 * The main-thread executor trades settle on. Work is queued here and the server's scheduler is
 * asked to run the queue; when the plugin is shutting down and the scheduler no longer runs tasks,
 * {@link #runUntil} lets the disabling thread (the main thread) run the queue itself, so trades in
 * flight still settle.
 */
public final class MainThreadPump implements Executor {

  private final LinkedBlockingQueue<Runnable> queue = new LinkedBlockingQueue<>();
  private final Executor scheduler;

  /**
   * @param scheduler asks the server to run a task on the main thread; it may drop the request
   *     while the plugin is disabling, since the task stays queued here
   */
  public MainThreadPump(Executor scheduler) {
    this.scheduler = scheduler;
  }

  @Override
  public void execute(Runnable task) {
    queue.add(task);
    scheduler.execute(this::runQueued);
  }

  /** Runs everything queued so far. Main thread only. */
  public void runQueued() {
    for (var task = queue.poll(); task != null; task = queue.poll()) {
      task.run();
    }
  }

  /**
   * Runs queued work as it arrives until {@code done} holds or {@code timeout} passes. Main thread
   * only, during shutdown: it blocks the thread for at most {@code timeout}.
   *
   * @return whether {@code done} held in time
   */
  public boolean runUntil(BooleanSupplier done, Duration timeout) {
    var deadline = System.nanoTime() + timeout.toNanos();
    while (!done.getAsBoolean()) {
      var remaining = deadline - System.nanoTime();
      if (remaining <= 0) {
        return false;
      }
      Runnable task;
      try {
        task = queue.poll(remaining, TimeUnit.NANOSECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return done.getAsBoolean();
      }
      if (task != null) {
        task.run();
      }
    }
    return true;
  }
}
