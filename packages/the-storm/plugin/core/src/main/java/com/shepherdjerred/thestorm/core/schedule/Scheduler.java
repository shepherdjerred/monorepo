package com.shepherdjerred.thestorm.core.schedule;

import java.time.Duration;
import java.util.concurrent.Executor;

/**
 * Main-thread scheduling. Paper's world state may only be touched on the main thread; this port is
 * the only way modules schedule work there, so it can be faked in tests and swapped for Folia's
 * region schedulers later.
 */
public interface Scheduler {

  /** Runs {@code task} on the main thread as soon as possible. */
  void runOnMainThread(Runnable task);

  /** Runs {@code task} on the main thread after {@code delay}. */
  Cancellable runOnMainThreadLater(Duration delay, Runnable task);

  /** Runs {@code task} on the main thread every {@code period}, starting after {@code delay}. */
  Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task);

  /** An executor that runs on the main thread, for completing futures back onto it. */
  Executor mainThread();
}
