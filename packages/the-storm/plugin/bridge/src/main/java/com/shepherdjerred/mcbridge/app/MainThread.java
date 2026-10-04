package com.shepherdjerred.mcbridge.app;

import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;

/**
 * Runs world work on the server's main thread. Callers are HTTP worker threads; they block on the
 * result, the main thread never does.
 */
public interface MainThread {
  /** Default deadline for world work. */
  Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);

  /**
   * Runs {@code task} on the main thread and waits for it.
   *
   * @throws com.shepherdjerred.mcbridge.domain.BridgeException with code {@code timeout} when the
   *     deadline passes, or the task's own {@code BridgeException}
   */
  <T> T call(Callable<T> task, Duration timeout);

  /**
   * Runs {@code task} on the main thread; the task itself returns a future that completes later
   * (for example after async chunk loads). Waits for that future.
   */
  <T> T callAsync(Callable<CompletableFuture<T>> task, Duration timeout);
}
