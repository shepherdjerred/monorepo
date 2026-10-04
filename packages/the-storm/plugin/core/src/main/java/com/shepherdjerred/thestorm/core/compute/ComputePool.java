package com.shepherdjerred.thestorm.core.compute;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Supplier;

/**
 * Bounded, named, off-main-thread CPU work: bot planning, hashing, serialization, recording I/O.
 * The plugin owns one pool and hands it to every module through {@code ModuleContext}; modules
 * never create threads or pools of their own, so a busy module cannot starve the server of cores
 * and every worker is accounted for on shutdown.
 *
 * <p>Work here must not touch Paper's world state. Complete results back onto the main thread with
 * {@code Scheduler.mainThread()}. Blocking network I/O (an HTTP client, a Discord gateway) does not
 * belong here either: it would hold one of a handful of platform threads; those adapters keep their
 * own virtual threads.
 */
public interface ComputePool extends AutoCloseable {

  /**
   * The executor for off-main-thread work. Once the pool is {@linkplain #close closed} it rejects
   * work with {@link RejectedExecutionException}.
   */
  Executor executor();

  /**
   * Runs {@code work} on the pool and completes the future with its result or failure. Throws
   * {@link RejectedExecutionException} once the pool is closed.
   */
  default <T> CompletableFuture<T> submit(Supplier<T> work) {
    return CompletableFuture.supplyAsync(work, executor());
  }

  /**
   * Stops accepting work and waits briefly for running work to finish. Idempotent: a second call
   * does nothing.
   */
  @Override
  void close();
}
