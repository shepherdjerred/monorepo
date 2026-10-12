package com.shepherdjerred.thestorm.core.compute;

import java.time.Duration;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;

/**
 * The production pool: a fixed set of daemon platform threads named {@code storm-compute-N}, sized
 * {@code max(1, availableProcessors - 1)} and capped at {@link #MAX_THREADS} so the server's own
 * tick thread always keeps a core. Work that throws outside a future is logged through the plugin
 * logger instead of dying silently on the worker.
 */
public final class PlatformComputePool implements ComputePool {

  /** The most threads the pool ever has, however many cores the host reports. */
  public static final int MAX_THREADS = 4;

  /** How long {@link #close} waits for running work before cutting it. */
  static final Duration CLOSE_WAIT = Duration.ofSeconds(5);

  private final ExecutorService executor;
  private final AtomicBoolean closed = new AtomicBoolean();

  PlatformComputePool(int threads, Logger logger) {
    if (threads < 1) {
      throw new IllegalArgumentException(
          "a compute pool needs at least one thread, not " + threads);
    }
    var factory =
        Thread.ofPlatform()
            .name("storm-compute-", 0)
            .daemon(true)
            .uncaughtExceptionHandler(
                (thread, failure) ->
                    logger.error("Compute work on {} failed", thread.getName(), failure))
            .factory();
    this.executor = Executors.newFixedThreadPool(threads, factory);
  }

  /** Opens a pool sized for this host, logging worker failures through {@code logger}. */
  public static PlatformComputePool open(Logger logger) {
    return new PlatformComputePool(size(Runtime.getRuntime().availableProcessors()), logger);
  }

  /** How many threads a host with {@code processors} cores gets. */
  static int size(int processors) {
    return Math.min(MAX_THREADS, Math.max(1, processors - 1));
  }

  @Override
  public Executor executor() {
    return executor;
  }

  @Override
  public void close() {
    if (!closed.compareAndSet(false, true)) {
      return;
    }
    executor.shutdown();
    try {
      if (!executor.awaitTermination(CLOSE_WAIT.toMillis(), TimeUnit.MILLISECONDS)) {
        executor.shutdownNow();
      }
    } catch (InterruptedException interrupted) {
      executor.shutdownNow();
      Thread.currentThread().interrupt();
    }
  }
}
